//! Where data lives, and how the app checks for a new version of itself.
//!
//! See the "Installer and Portable Layout" and "Update Channel and Signing
//! Keys" specs. Updates are pulled by the front-end through
//! `tauri-plugin-updater`. The check runs at launch, before the window is on
//! screen, so a reader either sees the new version or sees the old one — never
//! a window that replaces itself while they are reading.

use std::io;
use std::path::PathBuf;
use std::time::Duration;

use tauri::{Manager, Runtime};
use tauri_plugin_updater::UpdaterExt;

/// The file that marks a portable install. Its presence beside the
/// executable, plus a writable folder, is the whole test — no registry, no
/// environment variable.
const PORTABLE_MARKER: &str = ".portable";

/// Where `index.db`, `user.db`, and the log go.
///
/// A portable copy keeps its data beside the executable: the marker file
/// sits there, and opening it for append proves the folder still accepts
/// writes (an install under `Program Files` never does, so a copied marker
/// left there by mistake is harmless). Anything else — the per-user or
/// all-users install — uses `app_data_dir()`, which Tauri resolves to
/// `%APPDATA%\<identifier>`.
///
/// Same `Result<PathBuf, _>` shape as `app.path().app_data_dir()`, so the
/// call site is a one-line swap.
pub fn data_dir<R: Runtime>(app: &impl Manager<R>) -> io::Result<PathBuf> {
    if let Some(dir) = portable_dir()? {
        return Ok(dir);
    }
    app.path()
        .app_data_dir()
        .map(still_old)
        .map_err(|e| io::Error::other(e.to_string()))
}

/// The identifier of every release before 0.3.0, from when the app was
/// HoudiniMD. The system names folders after it, so an update moves them.
const OLD_IDENTIFIER: &str = "com.houdinimd.app";

/// The folders the system names after the identifier: the app data and the
/// webview's data, resolved as Tauri resolves them (`dirs`), and on macOS
/// WebKit's, which holds the local storage. On Linux and macOS the first two
/// are one folder.
fn identifier_bases() -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = [dirs::data_dir(), dirs::data_local_dir()].into_iter().flatten().collect();
    #[cfg(target_os = "macos")]
    bases.extend(dirs::home_dir().map(|home| home.join("Library/WebKit")));
    bases.dedup();
    bases
}

/// Moves each folder named for `OLD_IDENTIFIER` to the current identifier's
/// name, once: the reader keeps the index, bookmarks, settings, open tabs and
/// F1 hook across the rename. Runs before anything opens a file in them.
/// Windows refuses to move a folder with a file open in it; that folder then
/// stays where it is, the app reads it there (`still_old`), and the next
/// launch tries again. Returns what happened, for the log.
pub fn move_old_folders(identifier: &str) -> Vec<String> {
    if !matches!(portable_dir(), Ok(None)) {
        return Vec::new();
    }
    let mut said = Vec::new();
    for base in identifier_bases() {
        let (old, new) = (base.join(OLD_IDENTIFIER), base.join(identifier));
        // An empty folder under the new name is one a launch made before
        // this ran; the old folder still holds the reader's data.
        let new_is_empty = std::fs::read_dir(&new).is_ok_and(|mut entries| entries.next().is_none());
        if !old.is_dir() || (new.exists() && !new_is_empty) {
            continue;
        }
        if new_is_empty {
            let _ = std::fs::remove_dir(&new);
        }
        let mut result = std::fs::rename(&old, &new);
        for _ in 0..10 {
            if result.is_ok() {
                break;
            }
            std::thread::sleep(Duration::from_millis(300));
            result = std::fs::rename(&old, &new);
        }
        said.push(match result {
            Ok(()) => format!("moved {} to {}", old.display(), new.display()),
            Err(e) => format!("could not move {} ({e}); read in place", old.display()),
        });
    }
    said
}

/// `dir`, or the folder under the old identifier while that one could not
/// be moved yet (`move_old_folders`).
pub fn still_old(dir: PathBuf) -> PathBuf {
    let old = dir.with_file_name(OLD_IDENTIFIER);
    if !dir.exists() && old.is_dir() { old } else { dir }
}

/// `data_dir` for a process that exits before Tauri starts: the uninstaller's
/// `--unhook` and the installer's `--migrate`. It must find the same record
/// the app wrote, so it resolves the folder as Tauri's `app_data_dir()` does.
pub fn data_dir_before_launch(identifier: &str) -> io::Result<PathBuf> {
    if let Some(dir) = portable_dir()? {
        return Ok(dir);
    }
    let data = dirs::data_dir().ok_or_else(|| io::Error::other("no data folder"))?;
    Ok(still_old(data.join(identifier)))
}

fn portable_dir() -> io::Result<Option<PathBuf>> {
    let exe = std::env::current_exe()?;
    let Some(dir) = exe.parent() else {
        return Ok(None);
    };
    let writable = std::fs::OpenOptions::new()
        .append(true)
        .open(dir.join(PORTABLE_MARKER))
        .is_ok();
    Ok(writable.then(|| dir.to_path_buf()))
}

/// The updater plugin, configured from `tauri.conf.json` (public key,
/// endpoint). Register with `.plugin(update::plugin())` in `run()`.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R, tauri_plugin_updater::Config> {
    tauri_plugin_updater::Builder::new().build()
}

/// How long the launch check may hold the window back.
///
/// The window is hidden until this returns, so this is time the reader spends
/// looking at nothing. A machine with no network answers in well under a
/// second; one behind a captive portal never answers at all, and that is what
/// the limit is for.
const CHECK_LIMIT: Duration = Duration::from_secs(4);

/// Looks for a new version, installs it, and shows the window.
///
/// The window starts hidden (`"visible": false` in `tauri.conf.json`), so this
/// owns the moment it appears. Every path out of here shows it, including the
/// failures: no network, no answer, a bad signature. Only a successful install
/// leaves without showing, because that path restarts the app.
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(reason) = install(&app).await {
            crate::say!(Warn, "update", "check failed: {reason}");
        }
        // Started by Houdini: the reader asked for F1, not for a window. The
        // tray icon opens it.
        if crate::tray::in_background() {
            crate::tray::rest(&app);
        } else {
            crate::tray::show(&app);
        }
        crate::tray::settle();
    });
}

async fn install(app: &tauri::AppHandle) -> tauri_plugin_updater::Result<()> {
    // Debug builds have no signed bundle to update to, and the check would
    // just time out against the live endpoint on every `bun run app`.
    if cfg!(debug_assertions) || !wanted(app) {
        return Ok(());
    }
    let Some(update) = app
        .updater_builder()
        .timeout(CHECK_LIMIT)
        .build()?
        .check()
        .await?
    else {
        return Ok(());
    };
    crate::say!(Info, "update", "installing {}", update.version);
    update.download_and_install(|_, _| {}, || {}).await?;
    app.restart();
}

/// The setting behind the launch check. Absent means on: a reader who has never
/// touched the switch gets updates.
const AUTO_KEY: &str = "auto_update";

fn wanted(app: &tauri::AppHandle) -> bool {
    let Some(db) = app.try_state::<crate::Db>() else {
        return true;
    };
    let Ok(db) = db.0.lock() else {
        return true;
    };
    crate::db::get_setting(&db, AUTO_KEY).as_deref() != Some("0")
}
