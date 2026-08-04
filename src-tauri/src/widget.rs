// The home screen widget's data, iOS only.
//
// WidgetKit runs the widget extension as its own process, with no route back
// into this app's own state - the only way to hand it anything is a spot both
// processes can already reach. An App Group's shared UserDefaults is that
// spot: registered against this project's own Apple Developer team the same
// way iCloud.review.dev.app was (see icloud.rs), through Xcode's own Signing &
// Capabilities UI on both this target and the widget extension target.

use objc2::AnyThread;
use objc2_foundation::{NSString, NSUserDefaults};

const APP_GROUP: &str = "group.review.dev.app";
const QUEUE_COUNT_KEY: &str = "queueCount";

#[tauri::command]
pub fn widget_update(count: i64) -> Result<(), String> {
    let suite_name = NSString::from_str(APP_GROUP);
    let defaults = NSUserDefaults::initWithSuiteName(NSUserDefaults::alloc(), Some(&suite_name))
        .ok_or_else(|| "could not open the shared App Group defaults".to_string())?;

    defaults.setInteger_forKey(count as isize, &NSString::from_str(QUEUE_COUNT_KEY));
    defaults.synchronize();

    Ok(())
}
