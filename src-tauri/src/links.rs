// Links that lead off the app open in the system browser.
//
// The webview would otherwise follow them in place and replace the app with
// somebody else's page. On iOS there is no back button, so the reader is
// stranded. A `target="_blank"` link fares no better: wry implements
// createWebViewWithConfiguration on macOS only, and there it answers nil when
// no new-window handler is set, so the link does nothing; iOS has no
// implementation at all.
//
// This is one hook on every navigation of every webview, so it also catches
// any link a future code path renders. WebKit asks the navigation delegate
// about a new-window action too (with a nil targetFrame) before it asks for a
// new webview, so `_blank` links come through here as well.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime, Url,
};

/// The app's own pages are `tauri://localhost` on macOS and iOS, and
/// `http://tauri.localhost` on Windows and Android.
const APP_HOST: &str = "tauri.localhost";

/// Whether a navigation to this url would leave the app.
///
/// Only web urls leave. The app's own scheme, `about:` and `blob:` stay
/// in the webview exactly as before.
pub fn leaves_app(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str() != Some(APP_HOST)
}

/// The plugin that refuses navigation off the app and opens it outside.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("links")
        .on_navigation(|_, url| {
            if !leaves_app(url) {
                return true;
            }

            open(url);

            false
        })
        .build()
}

/// Hand the url to the system browser.
///
/// NSWorkspace asks Launch Services, which App Sandbox allows; spawning
/// `open` would be a subprocess, which it does not.
#[cfg(target_os = "macos")]
fn open(url: &Url) {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::{NSString, NSURL};

    let Some(target) = NSURL::URLWithString(&NSString::from_str(url.as_str())) else {
        return;
    };

    unsafe {
        let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
        let _: bool = msg_send![&workspace, openURL: &*target];
    }
}

/// Hand the url to the system browser.
///
/// The navigation delegate runs on the main thread, which UIApplication
/// needs. `openURL:` without options is not enough: iOS 18 refuses it.
#[cfg(target_os = "ios")]
fn open(url: &Url) {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::{NSString, NSURL};

    let Some(target) = NSURL::URLWithString(&NSString::from_str(url.as_str())) else {
        return;
    };

    unsafe {
        let application: Retained<AnyObject> = msg_send![class!(UIApplication), sharedApplication];
        let options: Retained<AnyObject> = msg_send![class!(NSDictionary), new];
        let done: Option<&AnyObject> = None;
        let _: () = msg_send![
            &application,
            openURL: &*target,
            options: &*options,
            completionHandler: done
        ];
    }
}

/// Hand the url to the system browser. The url is one argument to the
/// program, never a shell line, so nothing in it is interpreted.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
fn open(url: &Url) {
    #[cfg(windows)]
    let mut command = {
        let mut command = std::process::Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(not(windows))]
    let mut command = std::process::Command::new("xdg-open");

    let _ = command.arg(url.as_str()).spawn();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        Url::parse(text).expect("a url")
    }

    #[test]
    fn a_web_link_leaves_the_app() {
        assert!(leaves_app(&url("https://github.com/org/app/pull/44")));
        assert!(leaves_app(&url("http://example.com/")));
    }

    #[test]
    fn a_local_web_server_still_leaves_the_app() {
        assert!(leaves_app(&url("http://localhost:3000/")));
    }

    #[test]
    fn the_apps_own_pages_stay() {
        assert!(!leaves_app(&url("tauri://localhost/index.html")));
        assert!(!leaves_app(&url("http://tauri.localhost/index.html")));
        assert!(!leaves_app(&url("https://tauri.localhost/")));
    }

    #[test]
    fn non_web_schemes_stay() {
        assert!(!leaves_app(&url("about:blank")));
        assert!(!leaves_app(&url("blob:tauri://localhost/1234")));
        assert!(!leaves_app(&url("data:text/plain,hi")));
    }
}
