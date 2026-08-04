// The iCloud Drive source, iOS only.
//
// Unlike storage.rs's local folder, there is no folder to pick: an app's own
// ubiquity container is fixed by its identifier (iCloud.review.dev.app,
// registered against this project's Apple Developer team - see
// reviewer_iOS.entitlements) and NSFileManager hands back its URL directly.
// Everything past that root - listing, reading, writing, removing - is
// storage.rs's own storage_list/storage_read/storage_write/storage_remove,
// unchanged: they already take an arbitrary root and don't care how it was
// chosen, so this file's only job is resolving the one this source has.

use objc2_foundation::{NSFileManager, NSString};

// Matches com.apple.developer.icloud-container-identifiers in
// reviewer_iOS.entitlements - the two have to agree, or the container this
// asks for is one the app was never granted.
const CONTAINER: &str = "iCloud.review.dev.app";

/// The Documents folder inside this app's iCloud container, creating it if
/// this is the first time - iCloud does not create it on its own, and a
/// listing against a folder that has never existed reads the same as a
/// listing against an empty one, but a write into it needs somewhere real to
/// land first.
///
/// `Ok(None)` rather than an error when iCloud itself is not available -
/// signed out of iCloud, or the device has it turned off for this app -
/// which is a reader's ordinary account state, not a fault. The frontend's
/// `ready()` already tells them what to do about a source with no root, the
/// same sentence a local folder that was never chosen gets.
#[tauri::command]
pub fn icloud_root() -> Result<Option<String>, String> {
    let manager = NSFileManager::defaultManager();
    let identifier = NSString::from_str(CONTAINER);

    let Some(container) = manager.URLForUbiquityContainerIdentifier(Some(&identifier)) else {
        return Ok(None);
    };

    let documents_name = NSString::from_str("Documents");
    let documents = container
        .URLByAppendingPathComponent(&documents_name)
        .ok_or_else(|| "could not resolve the Documents folder inside the iCloud container".to_string())?;

    let path = documents
        .path()
        .ok_or_else(|| "the iCloud container's Documents folder has no filesystem path".to_string())?
        .to_string();

    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;

    Ok(Some(path))
}
