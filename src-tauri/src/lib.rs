// The desktop shell.
//
// It exists to hand the frontend one more adapter backend and a window to draw
// in. Everything the app does is still in web/src; nothing here knows what a
// review is.

mod storage;

/// Start the desktop app.
///
/// Split out of `main` because Tauri v2 builds mobile targets from a library
/// entry point rather than a binary.
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
        ])
        .run(tauri::generate_context!())
        .expect("the desktop app failed to start");
}
