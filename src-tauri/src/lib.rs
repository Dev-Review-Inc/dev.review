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
//
// The `appstore` feature - the sandboxed macOS bundle built for App Store/
// TestFlight distribution, see tauri.conf.appstore.json - excludes it for the
// same reason iOS does: App Sandbox forbids spawning a subprocess exactly
// like iOS sandboxing does, and shelling out to the real git binary is this
// module's entire premise. See git.rs's own top comment.
#[cfg(not(any(target_os = "ios", feature = "appstore")))]
mod git;
mod storage;

// The security-scoped bookmark that lets App Sandbox remember a folder the
// reader picked across a relaunch - see the comment at the top of
// bookmark.rs. Nothing else needs one: iOS has no lasting "arbitrary folder"
// concept to bookmark (see storage_pick_root), and the Developer ID `.dmg`
// build is not sandboxed, so a chosen folder is already reachable next time
// with no bookmark at all.
#[cfg(all(target_os = "macos", feature = "appstore"))]
mod bookmark;

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

// The home screen widget has no desktop equivalent - see the comment at the
// top of widget.rs for what it hands off and where.
#[cfg(target_os = "ios")]
mod widget;

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
            storage::storage_resume_root,
            #[cfg(not(feature = "appstore"))]
            git::git_root,
            #[cfg(not(feature = "appstore"))]
            git::git_forget,
            #[cfg(not(feature = "appstore"))]
            git::git_open,
            #[cfg(not(feature = "appstore"))]
            git::git_tree,
            #[cfg(not(feature = "appstore"))]
            git::git_read,
            #[cfg(not(feature = "appstore"))]
            git::git_commit_file,
            #[cfg(not(feature = "appstore"))]
            git::git_commit_removal,
            #[cfg(not(feature = "appstore"))]
            git::git_pull,
            #[cfg(not(feature = "appstore"))]
            git::git_push,
            #[cfg(not(feature = "appstore"))]
            git::git_ready,
            git_native_available,
        ])
        .run(tauri::generate_context!())
        .expect("the desktop app failed to start");
}

/// Whether this build's git.rs is present and can shell out to the real git.
///
/// Registered on every platform rather than only where it is true, so the
/// frontend can always ask rather than having to already know which build it
/// is in. web/src/adapters/git.js's `_pick` calls this once per source to
/// decide between git-native.js and git-isomorphic.js: false is exactly the
/// signal that used to only ever reach it as a failed `invoke` on a command
/// that was never registered, which is what a fallback that only "worked"
/// for the browser was reading as "not in Tauri" rather than "no native git
/// here" - iOS was never actually covered by it, and the sandboxed macOS
/// build would not have been either.
#[tauri::command]
fn git_native_available() -> bool {
    cfg!(not(any(target_os = "ios", feature = "appstore")))
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
            widget::widget_update,
            git_native_available,
        ])
        .run(tauri::generate_context!())
        .expect("the desktop app failed to start");
}
