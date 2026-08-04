// Keychain-backed secret storage, gated behind Face ID/Touch ID.
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

const SERVICE: &str = "dev.review";

// One Face ID prompt per app launch, not one per secret read. Health sweeps
// build a reader for every source at once (see App.probeSources in
// web/src/app/app.js), running them concurrently - without this, a reader
// with two GitHub sources got two stacked prompts, back to back, for the
// same reason a bank app does not ask again every time a screen within the
// same session touches your balance.
//
// A Mutex rather than a plain flag: those concurrent readers call in at the
// same time, and a flag checked-then-set without a lock lets two of them
// both see "not yet authenticated" and both open a Face ID sheet before
// either finishes. Held across the (blocking) prompt itself, so the second
// caller waits for the first one's answer instead of racing it.
static AUTHENTICATED: Mutex<bool> = Mutex::new(false);

// errSecItemNotFound, from Security/SecBase.h. Not exposed as a named
// constant by security-framework, so named here instead of left as a magic
// number with nothing to explain it.
const ITEM_NOT_FOUND: i32 = -25300;

fn is_not_found(error: &SecurityError) -> bool {
    error.code() == ITEM_NOT_FOUND
}

fn authenticate(app: &tauri::AppHandle, reason: &str) -> Result<(), String> {
    let mut authenticated = AUTHENTICATED.lock().map_err(|error| error.to_string())?;

    if *authenticated {
        return Ok(());
    }

    app.biometric()
        .authenticate(
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
        )
        .map_err(|error| error.to_string())?;

    *authenticated = true;

    Ok(())
}

/// Read a secret out of the Keychain, behind Face ID.
///
/// A missing entry is nothing, not a failure - the frontend asks before it
/// knows whether a secret was ever written, the same shape as storage_read
/// asking before knowing whether a draft was.
#[tauri::command]
pub fn keychain_get(app: tauri::AppHandle, account: String) -> Result<Option<String>, String> {
    authenticate(&app, "Unlock your saved GitHub token")?;

    match get_generic_password(SERVICE, &account) {
        Ok(bytes) => String::from_utf8(bytes).map(Some).map_err(|error| error.to_string()),
        Err(error) if is_not_found(&error) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

/// Write a secret to the Keychain, behind Face ID.
#[tauri::command]
pub fn keychain_set(app: tauri::AppHandle, account: String, value: String) -> Result<(), String> {
    authenticate(&app, "Confirm it's you before saving this token")?;

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
