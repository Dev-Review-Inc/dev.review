// The security-scoped bookmark that keeps a chosen folder reachable across a
// relaunch, under App Sandbox.
//
// Outside the sandbox, storage_pick_root's path is enough: the app can open
// anything on disk it has the path to, forever. Inside it, the path is only
// good for as long as the process that received it from the dialog is still
// running - App Sandbox revokes the grant the moment the app quits, and a
// plain path opened next time answers "operation not permitted" for a folder
// the reader picked five minutes ago and never unpicked. The bookmark is
// Apple's own answer: an opaque blob NSURL can turn back into a URL that is
// allowed to open, once, on each relaunch, after which the grant is live
// again until the app quits.
//
// tauri-plugin-fs already drives this dance, but only on iOS - see its
// ios.rs. There is no macOS equivalent to call into, so this module does on
// macOS what that file does on iOS: creates the bookmark when a folder is
// chosen, and resolves it and starts accessing the resource when the app
// needs that folder again.
//
// macOS and `appstore` only, for the same reason storage_pick_root's own
// doc comment gives for iOS not having one: a bookmark is only meaningful
// where the plain path it stands in for would otherwise stop working, and
// that is App Sandbox specifically, not the platform.

use std::fs;
use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_foundation::{
    NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};

/// Create a security-scoped bookmark for `path` and keep it somewhere this
/// app's own container can read it back from next launch.
///
/// Filed under the app's data directory rather than handed to the frontend to
/// store: a bookmark is bytes with no meaning to JavaScript, and a path is
/// already what storage_pick_root answers with, so there is nothing for the
/// frontend to do differently for this to work - restoring access on launch
/// is `resume`'s job alone.
pub fn save(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let url = file_url(path)?;

    // WithSecurityScope is what makes the bookmark carry sandbox access
    // rather than just a resolvable path; without it resolution below would
    // hand back a URL this process still has no permission to open.
    let options = NSURLBookmarkCreationOptions::WithSecurityScope;

    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            options, None, None,
        )
        .map_err(|error| {
            format!("could not create a bookmark for {}: {}", path.display(), &*error)
        })?;

    fs::create_dir_all(store_dir(app)?).map_err(|error| error.to_string())?;
    fs::write(bookmark_path(app, path)?, unsafe { data.as_bytes_unchecked() })
        .map_err(|error| error.to_string())
}

/// Resolve the bookmark for `path`, if one was saved, and start accessing the
/// resource it names.
///
/// Nothing saved is not a failure: the very first pick for a fresh install
/// has no bookmark yet, `save` above is what makes one, and the path handed
/// back from the dialog that same run is already accessible without one. A
/// bookmark that fails to resolve - the folder was moved, renamed, or its
/// volume is not mounted - is reported rather than swallowed, because the
/// alternative is every read after it failing with no explanation of why a
/// folder the reader chose stopped working.
pub fn resume(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let saved = bookmark_path(app, path)?;

    let Ok(bytes) = fs::read(&saved) else {
        return Ok(());
    };

    let data = NSData::with_bytes(&bytes);

    let mut stale = Bool::NO;
    let resolved = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut stale,
        )
    }
    .map_err(|error| {
        format!(
            "{} can no longer be opened; choose it again: {}",
            path.display(),
            &*error
        )
    })?;

    if !unsafe { resolved.startAccessingSecurityScopedResource() } {
        return Err(format!(
            "{} refused access; choose it again",
            path.display()
        ));
    }

    // A stale bookmark still resolved and still granted access this once -
    // the volume was renamed or the folder moved within it - so it is
    // refreshed for the relaunch after this one rather than failing here.
    if stale.as_bool() {
        let _ = save(app, path);
    }

    Ok(())
}

fn file_url(path: &Path) -> Result<Retained<NSURL>, String> {
    let canonical = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let text = canonical.to_str().ok_or_else(|| "not a valid path".to_string())?;

    Ok(NSURL::fileURLWithPath(&NSString::from_str(text)))
}

/// Where bookmarks are kept: the app's own data directory, which App Sandbox
/// grants unconditionally, rather than anywhere under the folder the
/// bookmark is about, which the app may not yet be able to write to.
fn store_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    app.path()
        .app_data_dir()
        .map(|dir| dir.join("bookmarks"))
        .map_err(|error| error.to_string())
}

/// One bookmark file per chosen folder, named after the path it stands in
/// for so a later `resume` for the same path finds it without an index.
fn bookmark_path(app: &tauri::AppHandle, path: &Path) -> Result<PathBuf, String> {
    Ok(store_dir(app)?.join(format!("{:x}.bookmark", fingerprint(path))))
}

/// A stable name for a path that will not collide across two different ones
/// and needs no filesystem-unsafe characters removed from it first.
fn fingerprint(path: &Path) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    hasher.finish()
}
