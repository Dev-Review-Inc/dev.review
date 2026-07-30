// Keep a console window from opening alongside the app on Windows. Only in
// release: the console is where the logs go while developing.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reviewer_lib::run();
}
