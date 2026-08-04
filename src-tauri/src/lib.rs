// The desktop shell.
//
// It exists to hand the frontend one more adapter backend and a window to draw
// in. Everything the app does is still in web/src; nothing here knows what a
// review is.

// Neither the folder-picker command nor the git module it sits beside has an
// iOS equivalent - see the comments on storage::storage_pick_root and at the
// top of git.rs for why each one specifically doesn't. Compiled out here
// rather than left in and unreachable, so an iOS build never carries code that
// cannot run on it.
#[cfg(not(target_os = "ios"))]
mod git;
mod storage;

// The Keychain has nothing to gate on desktop - it never held this app's
// secrets, and IndexedDB stays exactly as it was there. See Cargo.toml for
// why the crates this leans on are iOS-only dependencies.
#[cfg(target_os = "ios")]
mod keychain;

// A folder the reader picks is the desktop source; the iOS build's own fixed
// ubiquity container is this one instead - see the comment at the top of
// icloud.rs for why that means one new command rather than a whole parallel
// set of them.
#[cfg(target_os = "ios")]
mod icloud;

/// Start the desktop app.
///
/// Split out of `main` because Tauri v2 builds mobile targets from a library
/// entry point rather than a binary.
///
/// Two bodies rather than one `run` with a command list picked by `cfg`: the
/// handler `generate_handler!` produces only has a type once it is unified
/// against `invoke_handler`'s own bound at the call site, and a `let` in
/// between - even one only one arm of which ever compiles - loses that and
/// leaves the compiler unable to infer it.
#[cfg(not(target_os = "ios"))]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The folder picker is opened from Rust, so the frontend needs no
        // dialog permission of its own.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            storage::storage_pick_root,
            storage::storage_list,
            storage::storage_read,
            storage::storage_write,
            storage::storage_remove,
            git::git_root,
            git::git_forget,
            git::git_open,
            git::git_tree,
            git::git_read,
            git::git_commit_file,
            git::git_commit_removal,
            git::git_pull,
            git::git_push,
            git::git_ready,
        ])
        .run(tauri::generate_context!())
        .expect("the desktop app failed to start");
}

/// storage_list/read/write/remove only ever get called against a root
/// storage_pick_root returned, and that command doesn't exist here, so
/// nothing on iOS calls these either - the sources left are the ones that
/// were always cross-platform, a GitHub repository over the Contents API and
/// an S3 bucket, both plain fetch() from the frontend with no native command
/// behind them at all. Registered anyway rather than left empty:
/// `generate_handler![]` with nothing in it can't infer its own type, and a
/// command with no caller costs nothing sitting unused.
#[cfg(target_os = "ios")]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_biometric::init())
        .invoke_handler(tauri::generate_handler![
            storage::storage_list,
            storage::storage_read,
            storage::storage_write,
            storage::storage_remove,
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_delete,
            icloud::icloud_root,
        ])
        .run(tauri::generate_context!())
        .expect("the desktop app failed to start");
}
