//! The app keeps running when its window closes.
//!
//! The localhost server is what answers F1 inside Houdini, so the window is a
//! view onto a process that must outlive it. Closing the window hides it; the
//! tray icon brings it back, and its menu is the one way to quit.
//! See spec: Closing the app sends it to the notification tray.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};

/// Started by Houdini, not by the reader: serve F1, keep the window hidden.
pub const BACKGROUND: &str = "--background";

pub fn in_background() -> bool {
    std::env::args().any(|argument| argument == BACKGROUND)
}

pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        memory(&window, false);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Set once the launch check has shown the window or left it in the tray.
static SETTLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn settle() {
    SETTLED.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// A link opened while the app runs (macOS sends it to the running process).
/// A link that comes before the launch check is done is the one that started
/// the app, and the check shows the window when it ends.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn link_opened(app: &AppHandle) {
    if SETTLED.load(std::sync::atomic::Ordering::Relaxed) {
        show(app);
    }
}

/// A second launch lands here instead of starting a second process. A launch
/// from Houdini only wants the server, which is already up.
pub fn second_launch(app: &AppHandle, argv: Vec<String>) {
    if !argv.iter().any(|argument| argument == BACKGROUND) {
        show(app);
    }
}

pub fn build(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", &format!("Open {}", crate::APP_NAME), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &format!("Quit {}", crate::APP_NAME), true, None::<&str>)?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(crate::APP_NAME)
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        // A menu bar item opens its menu on a click; a tray icon opens the
        // window, and keeps its menu for the right button.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event
                && !cfg!(target_os = "macos")
            {
                show(tray.app_handle());
            }
        });
    // The menu bar draws a template from its alpha, in the bar's own colour.
    #[cfg(target_os = "macos")]
    {
        tray = tray
            .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
            .icon_as_template(true);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// The setting that makes the close button quit. Anything but "false" keeps
/// the app in the tray. Settings, General, writes it.
const CLOSE_TO_TRAY: &str = "close_to_tray";

fn closes_to_tray(app: &AppHandle) -> bool {
    app.try_state::<crate::Db>()
        .and_then(|db| db.0.lock().ok().map(|db| crate::db::get_setting(&db, CLOSE_TO_TRAY)))
        .flatten()
        .as_deref()
        != Some("false")
}

/// The close button hides the first window. The process, and F1 with it,
/// stays. A window opened after it (Ctrl N) closes for good. With the setting
/// off, the close button quits, as the tray menu's Quit does; a launch from
/// Houdini starts the app again.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if !closes_to_tray(window.app_handle()) {
            window.app_handle().exit(0);
            return;
        }
        let _ = window.hide();
        rest(window.app_handle());
    }
}

/// The main window is hidden: its webview gives memory back.
pub fn rest(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        memory(&window, true);
    }
}

/// Scripts keep running at the low level (unlike `TrySuspend`), so the index
/// progress and the page F1 opens still reach a hidden window. WebView2 does
/// not set the level back by itself; `show` does.
// The call below is WebView2, so off Windows both arguments go unread.
#[cfg_attr(not(windows), allow(unused_variables))]
fn memory(window: &tauri::WebviewWindow, low: bool) {
    #[cfg(windows)]
    let _ = window.with_webview(move |webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use windows_core::Interface;
        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        if let Ok(core) = webview.controller().CoreWebView2().and_then(|core| core.cast::<ICoreWebView2_19>()) {
            let _ = core.SetMemoryUsageTargetLevel(level);
        }
    });
}
