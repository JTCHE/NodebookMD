//! Reports a WebKitGTK web process that died. On Linux the page runs in its
//! own process; when that process dies the window goes blank and no front-end
//! error and no panic is left to tell us. The launch event already carries the
//! operating system version, so the dashboard can tie a death to a distro.

use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "linux")]
pub fn watch(window: &WebviewWindow, app: AppHandle) {
    let _ = window.with_webview(move |webview| {
        use webkit2gtk::{WebProcessTerminationReason, WebViewExt};
        webview.inner().connect_web_process_terminated(move |_, reason| {
            let message = match reason {
                WebProcessTerminationReason::Crashed => "web process crashed",
                WebProcessTerminationReason::ExceededMemoryLimit => "web process exceeded memory limit",
                _ => "web process terminated",
            };
            crate::say!(Error, "webview", "{message}");
            crate::telemetry::error(&app, message);
        });
    });
}

/// WebView2 and WKWebView do not go blank the same way, so nothing to watch.
#[cfg(not(target_os = "linux"))]
pub fn watch(_window: &WebviewWindow, _app: AppHandle) {}
