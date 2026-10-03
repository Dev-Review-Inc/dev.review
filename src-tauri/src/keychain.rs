// Keychain-backed secret storage, gated behind Face ID/Touch ID when a secret is saved.
//
// iOS only - see Cargo.toml for why this doesn't even compile on desktop.
// This is what the frontend's secret()/setSecret() in multi-event-store.js
// fall back to on iOS instead of IndexedDB, which has no lock of its own:
// the token that lets someone post a review as the reader deserves sturdier
// keeping than a database any app on the device could, in principle, be
// tricked into reading.
//
// One keychain service for everything this app stores; the account name is
// what tells two secrets apart, matching how the frontend already keys them
// ("secret:<source-or-destination-id>" becomes the account here).

use std::sync::Mutex;

use security_framework::base::Error as SecurityError;
use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};
use tauri_plugin_biometric::{AuthOptions, BiometricExt};

use crate::unlock::{self, Lock, Read};

const SERVICE: &str = "dev.review";

// The secrets are GitHub tokens, git tokens and S3 keys, and the account name
// does not say which, so the prompts name none of them.
const READ_REASON: &str = "Unlock the tokens and keys you saved";
const WRITE_REASON: &str = "Confirm it's you before saving this token or key";

const REFUSED: &str = "Saved tokens and keys stay locked because unlocking was cancelled. Quit and reopen the app to try again.";

// One prompt per app launch, not one per secret read. Health sweeps build a
// reader for every source at once (see App.probeSources in web/src/app/app.js),
// running them concurrently.
//
// A Mutex rather than a plain flag: those concurrent readers call in at the
// same time, and a check-then-set without a lock lets two of them both open a
// sheet. Held across the (blocking) prompt itself, so the second caller waits
// for the first one's answer. A cancel is remembered as Refused, so the
// callers queued behind it, and every read after, refuse instead of asking
// again - see unlock.rs.
static LOCK: Mutex<Lock> = Mutex::new(Lock::Locked);

// errSecItemNotFound, from Security/SecBase.h. Not exposed as a named
// constant by security-framework, so named here instead of left as a magic
// number with nothing to explain it.
const ITEM_NOT_FOUND: i32 = -25300;

fn is_not_found(error: &SecurityError) -> bool {
    error.code() == ITEM_NOT_FOUND
}

fn authenticate(app: &tauri::AppHandle, lock: &mut Lock, reason: &str) -> Result<(), String> {
    let outcome = app.biometric().authenticate(
        reason.to_string(),
        AuthOptions {
            // The passcode is the same fallback iOS itself offers when
            // Face ID fails or isn't enrolled - refusing it would lock
            // out a reader who has declined Face ID but still has a
            // device passcode set, for no security this app is the one
            // to provide.
            allow_device_credential: true,
            ..Default::default()
        },
    );

    match outcome {
        Ok(()) => {
            *lock = Lock::Unlocked;
            Ok(())
        }
        Err(error) => {
            *lock = Lock::Refused;
            Err(format!("{REFUSED} ({error})"))
        }
    }
}

/// Read a secret out of the Keychain, behind Face ID when one is saved.
///
/// A missing entry is nothing, not a failure, and asks nothing - the frontend
/// asks before it knows whether a secret was ever written, the same shape as
/// storage_read asking before knowing whether a draft was.
///
/// The item is fetched BEFORE the prompt, to learn whether there is anything
/// to unlock. That weakens nothing the OS enforces: set_generic_password
/// writes only class, service, account and data, with no SecAccessControl, so
/// the Keychain hands the item to this app without any prompt of its own. The
/// Face ID gate is this app's, and it still stands between the item and the
/// webview.
#[tauri::command]
pub fn keychain_get(app: tauri::AppHandle, account: String) -> Result<Option<String>, String> {
    let mut lock = LOCK.lock().map_err(|error| error.to_string())?;

    let saved = match get_generic_password(SERVICE, &account) {
        Ok(bytes) => Some(bytes),
        Err(error) if is_not_found(&error) => None,
        Err(error) => return Err(error.to_string()),
    };

    match unlock::read(saved.is_some(), *lock) {
        Read::Nothing => return Ok(None),
        Read::Refuse => return Err(REFUSED.to_string()),
        Read::Prompt => authenticate(&app, &mut lock, READ_REASON)?,
        Read::Release => {}
    }

    saved
        .map(|bytes| String::from_utf8(bytes).map_err(|error| error.to_string()))
        .transpose()
}

/// Write a secret to the Keychain, behind Face ID.
#[tauri::command]
pub fn keychain_set(app: tauri::AppHandle, account: String, value: String) -> Result<(), String> {
    let mut lock = LOCK.lock().map_err(|error| error.to_string())?;

    if unlock::write_prompts(*lock) {
        authenticate(&app, &mut lock, WRITE_REASON)?;
    }

    set_generic_password(SERVICE, &account, value.as_bytes()).map_err(|error| error.to_string())
}

/// Delete a secret from the Keychain. Already gone counts as done, matching
/// storage_remove - and matching it in not asking for Face ID either:
/// removing a secret the reader can no longer produce is not reading it.
#[tauri::command]
pub fn keychain_delete(account: String) -> Result<(), String> {
    match delete_generic_password(SERVICE, &account) {
        Ok(()) => Ok(()),
        Err(error) if is_not_found(&error) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
