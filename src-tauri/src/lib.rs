/// The app's name, from `productName` in `tauri.conf.json` (see `build.rs`).
pub const APP_NAME: &str = env!("APP_NAME");

pub mod db;
pub mod hook;
pub mod log;
pub mod library;
pub mod mcp;
pub mod preview;
pub mod server;
pub mod telemetry;
pub mod tray;
pub mod update;

/// The reading itself is the `engine` crate, which knows nothing about a
/// window: installs, pages, the index and the search. This app is one caller
/// of it — the Python module is the other. Re-exported under the names the
/// rest of this crate already uses.
pub use engine::{
    Hit, Meta, PageError, PageView, Section, all_titles, find, help, index, install, read_meta,
    read_page,
};

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::http::{Request, Response};
use tauri::{Emitter, Manager, State};

/// The one connection the reader's own queries run on. `index.db` is open
/// here with `user.db` attached; the background pass keeps its own connection,
/// so a long write never holds up a search.
pub(crate) struct Db(pub(crate) Mutex<rusqlite::Connection>);

/// The app's own data directory, so a command that starts a background index
/// pass does not need to ask for it again.
struct DataDir(std::path::PathBuf);

/// The installs found on this machine, newest build first. Cached: a scan
/// happens once and again only when `refresh` is asked for, which is what the
/// version picker does when the reader opens it.
#[tauri::command(async)]
fn installs(cache: State<Arc<install::Cache>>, refresh: Option<bool>) -> Vec<install::Install> {
    if refresh.unwrap_or(false) { cache.refresh() } else { cache.get() }
}

/// The install every command reads right now. Not the newest on the machine —
/// the one the reader chose. Costs no scan; the cache already holds it.
#[tauri::command]
fn current_install(
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
) -> Result<install::Install, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    current(&db, &chosen, &cache)
}

/// One row of the version picker: a build and how much of it is indexed.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRow {
    pub version: String,
    pub pages: u32,
    pub done: bool,
    pub current: bool,
}

/// Every install on the machine, with its page count, for the version picker.
/// Rescans first — the picker is the one place a scan is worth its cost.
#[tauri::command(async)]
fn available_installs(
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
) -> Result<Vec<BuildRow>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    // A machine with no install yet still needs this list — empty, so the
    // reader can reach the "pick a folder" row instead of getting an error
    // in place of the picker.
    let now = current(&db, &chosen, &cache).map(|i| i.version).unwrap_or_default();
    Ok(cache
        .refresh()
        .into_iter()
        .map(|install| {
            let status = index::status(&db, &install.version);
            BuildRow {
                current: install.version == now,
                version: install.version,
                pages: status.pages,
                done: status.done,
            }
        })
        .collect())
}

/// Switches the build every command reads. Persists the choice, and starts
/// the background index pass for it when the index has not already filled it.
#[tauri::command]
fn select_install(
    app: tauri::AppHandle,
    data: State<DataDir>,
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
    version: String,
) -> Result<BuildRow, String> {
    let install = cache
        .get()
        .into_iter()
        .find(|i| i.version == version)
        .ok_or_else(|| format!("Houdini {version} is not on this machine"))?;
    let db = state.0.lock().map_err(|e| e.to_string())?;
    switch(app, &data, &db, &chosen, install)
}

/// Adds a Houdini install the reader pointed at by hand, and switches to it.
/// The scan only looks where the installer puts a build, so a studio install
/// on another drive reaches the app through here and through nowhere else.
#[tauri::command]
fn add_install(
    app: tauri::AppHandle,
    data: State<DataDir>,
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
    path: String,
) -> Result<BuildRow, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let (install, picked) = install::add_picked(&cache, std::path::PathBuf::from(path))?;
    db::set_setting(&db, install::PICKED_KEY, &picked)?;
    switch(app, &data, &db, &chosen, install)
}

/// Makes `install` the build every command reads, and starts its index pass
/// when the index does not already hold it.
fn switch(
    app: tauri::AppHandle,
    data: &DataDir,
    db: &rusqlite::Connection,
    chosen: &install::Chosen,
    install: install::Install,
) -> Result<BuildRow, String> {
    db::set_setting(db, install::BUILD_KEY, &install.version)?;
    install::set_chosen(chosen, install.clone())?;
    let status = index::status(db, &install.version);
    crate::say!(Info, "install", "switched to Houdini {}, {} pages in, done {}", install.version, status.pages, status.done);
    if !status.done {
        start_index(app, data.0.clone(), install.clone(), false);
    }
    Ok(BuildRow {
        current: true,
        version: install.version,
        pages: status.pages,
        done: status.done,
    })
}

/// The port the localhost server took, for the landing page to show. Zero
/// when the server did not start.
#[tauri::command]
fn server_port(state: State<Port>) -> u16 {
    state.0
}

/// Who is signed in, for the greeting on the landing page. Empty where the
/// platform does not say, which the front-end greets without a name.
#[tauri::command]
fn user_name() -> String {
    user_name_of_this_machine()
}

/// The same name, without the app around it, for the localhost server.
pub fn user_name_of_this_machine() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
}

/// Reads and parses one page, such as `nodes/sop/copytopoints`.
///
/// This never waits on the index. The first page a reader opens is parsed here
/// even if the background pass has not reached it yet.
#[tauri::command(async)]
fn page(
    app: tauri::AppHandle,
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
    path: String,
) -> Result<PageView, PageError> {
    let started = std::time::Instant::now();
    let db = state.0.lock().map_err(|e| PageError { missing: false, message: e.to_string() })?;
    let install = current(&db, &chosen, &cache)
        .map_err(|message| PageError { missing: false, message })?;
    let node_versions = engine::versions::of(&db, &install.version, &path);
    drop(db);
    let mut view = read_page(&install, &path)?;
    view.node_versions = node_versions;
    telemetry::page_opened(&app, started.elapsed().as_secs_f64() * 1000.0);
    Ok(view)
}

/// An error the front end did not catch, for the telemetry. Sends nothing when
/// the reader said no.
#[tauri::command]
fn report_error(app: tauri::AppHandle, message: String) {
    crate::say!(Error, "window", "{message}");
    telemetry::error(&app, &message);
}

/// Opens `logs/` in the file manager, for a reader who was asked for it.
#[tauri::command]
fn show_logs(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = log::dir().ok_or("the log folder is not open")?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// The first launch ended, or a part of the app was used. See
/// `telemetry::track`. Sends nothing when the reader said no.
#[tauri::command]
fn report_use(app: tauri::AppHandle, kind: String, name: String) {
    if kind == "setup" || kind == "feature" {
        telemetry::track(&app, &kind, &name);
    }
}

/// One search that ended. See `telemetry::search`. No words, ever.
#[tauri::command]
fn report_search(app: tauri::AppHandle, hits: u32, rank: i32) {
    telemetry::search(&app, hits, rank);
}

/// Opens the file that holds every payload the telemetry has sent.
#[tauri::command]
fn show_telemetry_log(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let log = telemetry::log_path(&app);
    if !log.exists() {
        std::fs::write(&log, "").map_err(|e| e.to_string())?;
    }
    app.opener().open_path(log.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// The asset file an `examples/` page describes, beside its text in the help.
pub fn example_file(install: &install::Install, path: &str) -> Option<std::path::PathBuf> {
    if !path.starts_with("examples/") || path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return None;
    }
    install
        .help_roots()
        .into_iter()
        .flat_map(|root| ["otl", "hda"].map(|extension| root.join(format!("{path}.{extension}"))))
        .find(|file| file.is_file())
}

/// Whether the page has an example file to launch.
#[tauri::command]
fn has_example(
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
    path: String,
) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(example_file(&current(&db, &chosen, &cache)?, &path).is_some())
}

/// Starts a new Houdini with the page's example in it, the way Houdini's own
/// help does its Launch button: `houdini waitforui loadHelpcardOTLExample.py
/// /examples/….otl`. A new process, so the reader's open scene is not touched.
#[tauri::command]
fn launch_example(
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
    path: String,
) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let install = current(&db, &chosen, &cache)?;
    drop(db);
    let file = example_file(&install, &path).ok_or_else(|| format!("No example file for {path}"))?;
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or("otl");
    // `python3.11libs`, `python3.13libs`: the one this build ships.
    let script = std::fs::read_dir(install.root.join("houdini"))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("loadHelpcardOTLExample.py"))
        .find(|script| script.is_file())
        .ok_or("This Houdini has no example loader")?;
    let houdini = install.root.join("bin").join(if cfg!(windows) { "houdini.exe" } else { "houdini" });
    let mut command = std::process::Command::new(houdini);
    // The folder the Start Menu shortcut starts Houdini in.
    if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
        command.current_dir(home);
    }
    command
        .arg("waitforui")
        .arg(script)
        .arg(format!("/{path}.{extension}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start Houdini: {e}"))
}

/// Writes the page to a file under the temp folder and opens it in the app the
/// reader has for that kind of file. `source` asks for the help text the page
/// is made from, as a `.txt`; otherwise the Markdown, as a `.md`.
#[tauri::command]
fn open_page(
    app: tauri::AppHandle,
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
    path: String,
    source: bool,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
        return Err(format!("Not a page path: {path}"));
    }
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let install = current(&db, &chosen, &cache)?;
    drop(db);
    let (text, extension) = if source {
        let text = help::page_layered(&install.help_roots(), &path)
            .map_err(|_| format!("No help text for {path}"))?;
        (text, "txt")
    } else {
        (read_page(&install, &path).map_err(|e| e.message)?.portable, "md")
    };
    // The page's own path under the temp folder, so two pages with the same
    // last name do not write over each other.
    let (folders, name) = path.rsplit_once('/').unwrap_or(("", &path));
    let mut file = std::env::temp_dir().join(APP_NAME);
    file.extend(folders.split('/').filter(|part| !part.is_empty()));
    std::fs::create_dir_all(&file).map_err(|e| e.to_string())?;
    file.push(format!("{name}.{extension}"));
    std::fs::write(&file, text).map_err(|e| e.to_string())?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Asks where to save the page, then writes it there. The dialog is opened
/// here and not in the page, so the page never names a path to write. The
/// chosen name picks the form: `.html` writes the page as a document, anything
/// else writes its Markdown. Async, because a blocking dialog on the main
/// thread stops the window.
#[tauri::command]
async fn save_page(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    markdown: String,
    html: String,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(chosen) = app
        .dialog()
        .file()
        // The window owns the dialog. Without an owner the dialog opened
        // behind the window when the reader came from the webview's own
        // right-click menu: that menu is closing as the dialog is made, and
        // Windows gives the front to nothing in between.
        .set_parent(&window)
        .set_file_name(format!("{name}.md"))
        .add_filter("Markdown", &["md"])
        .add_filter("HTML", &["html", "htm"])
        .add_filter("Text", &["txt"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let file = chosen.into_path().map_err(|e| e.to_string())?;
    let wants_html = file
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("html") || e.eq_ignore_ascii_case("htm"));
    std::fs::write(file, if wants_html { html } else { markdown }).map_err(|e| e.to_string())?;
    Ok(true)
}

/// The vaults Obsidian knows, most recently opened first, read from its own
/// `obsidian.json`. Only paths that are still folders; none where Obsidian is
/// not installed.
#[derive(serde::Serialize)]
struct Vault {
    path: String,
    name: String,
}

#[tauri::command]
fn obsidian_vaults() -> Vec<Vault> {
    let config = if cfg!(windows) {
        std::env::var_os("APPDATA").map(std::path::PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| std::path::Path::new(&home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| std::path::Path::new(&home).join(".config")))
    };
    let Some(text) = config.and_then(|dir| std::fs::read_to_string(dir.join("obsidian/obsidian.json")).ok()) else {
        return Vec::new();
    };
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let mut vaults: Vec<(i64, Vault)> = json["vaults"]
        .as_object()
        .into_iter()
        .flat_map(|all| all.values())
        .filter_map(|vault| {
            let path = vault["path"].as_str()?;
            let dir = std::path::Path::new(path);
            dir.is_dir().then(|| {
                let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string());
                (vault["ts"].as_i64().unwrap_or(0), Vault { path: path.to_string(), name })
            })
        })
        .collect();
    vaults.sort_by(|a, b| b.0.cmp(&a.0));
    vaults.into_iter().map(|(_, vault)| vault).collect()
}

/// Writes the page into the vault at `vault`, in a folder named for the
/// app, its pictures beside it in `attachments/`. The reader picks the
/// vault in the app (see `ObsidianDialog`); this only writes, and returns the
/// note's path for the app to open it.
///
/// Pictures come out of the zip the app already reads pages from, not off the
/// screen, so nothing has to leave the app just to come back as bytes.
#[tauri::command]
async fn send_to_obsidian(app: tauri::AppHandle, vault: String, title: String, markdown: String) -> Result<String, String> {
    let vault = std::path::PathBuf::from(vault);
    if !vault.is_dir() {
        return Err(format!("{} is not a folder", vault.display()));
    }
    let folder = vault.join(APP_NAME);
    let attachments = folder.join("attachments");
    std::fs::create_dir_all(&attachments).map_err(|e| e.to_string())?;

    let install = current_for(&app)?;
    let roots = install.help_roots();
    let mut note = markdown.clone();
    let mut carried = std::collections::HashSet::new();
    for kind in ["images/", "videos/"] {
        for asset in asset_paths(&markdown, kind) {
            if !carried.insert(asset.clone()) {
                continue;
            }
            let Ok(bytes) = help::asset_layered(&roots, &asset) else { continue };
            let file_name = asset.rsplit('/').next().unwrap_or(&asset);
            std::fs::write(attachments.join(file_name), bytes).map_err(|e| e.to_string())?;
            note = note.replace(&asset, &format!("attachments/{file_name}"));
        }
    }

    let safe: String = title.chars().map(|c| if "\\/:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    let safe = safe.trim();
    let path = folder.join(format!("{}.md", if safe.is_empty() { "page" } else { safe }));
    std::fs::write(&path, note).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Every `<kind>path/to/file.ext` substring `text` carries, ending at the
/// nearest `)`, `"` or space — the ways an asset path ends inside a Markdown
/// image or an HTML `src`.
fn asset_paths(text: &str, kind: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut at = 0;
    while let Some(rel) = text[at..].find(kind) {
        let start = at + rel;
        let end = text[start..]
            .find(|c: char| c == ')' || c == '"' || c.is_whitespace())
            .map(|i| start + i)
            .unwrap_or(text.len());
        found.push(text[start..end].to_string());
        at = end;
    }
    found
}

/// Every window comes from the one entry in `tauri.conf.json`, which has no
/// system frame: the bar draws its own buttons. On macOS the system frame
/// stays, with the traffic lights drawn over the left of that bar.
fn window<'a, R: tauri::Runtime, M: Manager<R>>(
    manager: &'a M,
    config: &tauri::utils::config::WindowConfig,
) -> tauri::Result<tauri::WebviewWindowBuilder<'a, R, M>> {
    let builder = tauri::WebviewWindowBuilder::from_config(manager, config)?;
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(14.0, 18.0));
    Ok(builder)
}

/// Opens one more window, made from the same entry in `tauri.conf.json` as the
/// first, on the home page or on `path` (`/nodes/sop/box#inputs`). It stays
/// hidden until its page has loaded, so it never shows an empty frame. Async,
/// because a window made in a blocking command stops the window thread on
/// Windows.
#[tauri::command]
async fn new_window(app: tauri::AppHandle, path: Option<String>) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri::webview::PageLoadEvent;
    static NEXT: AtomicU32 = AtomicU32::new(1);
    let mut config = app.config().app.windows[0].clone();
    config.label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    if let Some(path) = path {
        // A path in the app, never an address: the window must not load
        // another site with the app's rights.
        if !path.starts_with('/') || path.starts_with("//") || path.contains("..") {
            return Err(format!("Not a page path: {path}"));
        }
        config.url = tauri::WebviewUrl::App(path.trim_start_matches('/').into());
    }
    window(&app, &config)
        .map_err(|e| e.to_string())?
        .on_page_load(|window, load| {
            if load.event() == PageLoadEvent::Finished {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Closes the window that asks, as its own close button does: the first
/// window hides to the tray (see `tray::on_window_event`), another one closes.
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// Opens the browser tools on the window that asks. Only a debug build has
/// them; in a release build this does nothing.
#[tauri::command]
fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

/// Every page title in the current build.
///
/// The whole list goes to the front-end once and stays in memory there, which
/// is what makes the pick in the search field instant. 10,450 titles are small.
#[tauri::command(async)]
fn titles(state: State<Db>, chosen: State<Arc<install::Chosen>>, cache: State<Arc<install::Cache>>) -> Result<Vec<Hit>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let build = current(&db, &chosen, &cache)?.version;
    all_titles(&db, &build)
}

/// The tooltip text for a set of pages, asked for in one call.
///
/// The index answers most of it. A page the background pass has not reached is
/// read and parsed here instead, so a tooltip on a fresh install says the same
/// thing it will say later — the front-end batches, so this is a handful of
/// pages at a time, not the whole viewport one at a time.
#[tauri::command(async)]
fn meta(state: State<Db>, chosen: State<Arc<install::Chosen>>, cache: State<Arc<install::Cache>>, paths: Vec<String>) -> Result<Vec<Meta>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let install = current(&db, &chosen, &cache)?;
    read_meta(&db, &install, &paths)
}

/// The share card of a link that leaves the help, for its tooltip.
#[tauri::command]
async fn link_preview(url: String) -> Result<preview::Preview, String> {
    preview::fetch(&url).await
}

/// The reader's own data: bookmarks, recents, settings. One connection, one
/// module (`library.rs`), so the window and Houdini's help pane read and
/// write the same rows — see spec: Local — User config shared between the
/// window and the help pane.
#[tauri::command(async)]
fn recents(state: State<Db>) -> Result<Vec<library::Entry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    library::recents(&db)
}

#[tauri::command(async)]
fn bookmarks(state: State<Db>) -> Result<Vec<library::Entry>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    library::bookmarks(&db)
}

/// Flat arguments, not a struct: `backend.ts` sends the same shape whether it
/// invokes this in Tauri or asks `server.rs` for it over a query string, and a
/// query string has no nesting.
#[tauri::command]
fn record_visit(state: State<Db>, path: String, title: String, icon: Option<String>, at: i64) -> Result<i64, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    library::record_visit(&db, &library::Entry { id: None, path, title, icon, at })
}

#[tauri::command]
fn forget_recent(state: State<Db>, id: i64) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    library::forget(&db, id)
}

#[tauri::command]
fn toggle_bookmark(state: State<Db>, path: String, title: String, icon: Option<String>, at: i64) -> Result<bool, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    library::toggle_bookmark(&db, &library::Entry { id: None, path, title, icon, at })
}

#[tauri::command]
fn get_setting(state: State<Db>, key: String) -> Result<Option<String>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    Ok(db::get_setting(&db, &key))
}

#[tauri::command]
fn set_setting(state: State<Db>, key: String, value: String) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db::set_setting(&db, &key, &value)
}

/// Full-text search over the page bodies, ranked with `bm25()`.
///
/// A row of the index is a section, so the ranking is over sections and the
/// pages come out of it: the first section of a page decides where the page
/// sits, and its other matching sections are listed beneath it. That is what
/// the result list draws, and it is why the query asks for more rows than the
/// caller wants pages.
///
/// The title and heading columns are weighted above the body, so a page named
/// for the words beats a page that only mentions them.
#[tauri::command(async)]
fn search(state: State<Db>, chosen: State<Arc<install::Chosen>>, cache: State<Arc<install::Cache>>, query: String, limit: u32) -> Result<Vec<Hit>, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let build = current(&db, &chosen, &cache)?.version;
    find(&db, &build, &query, limit)
}

/// The pass's state, plus whether a pass has written in this process. The
/// window reads `wrote` on mount: the pass starts before the page exists, so
/// the reports it made while the webview loaded reached nobody, and without
/// this the window keeps the title list it read at boot — empty on a fresh
/// index — until the reader reloads it by hand.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusNow {
    #[serde(flatten)]
    status: index::Status,
    wrote: bool,
}

/// How far the background pass has got. The front-end also gets this as an
/// `index` event, so this call is only for what it missed before it mounted.
#[tauri::command(async)]
fn index_status(state: State<Db>, chosen: State<Arc<install::Chosen>>, cache: State<Arc<install::Cache>>) -> Result<StatusNow, String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    let build = current(&db, &chosen, &cache)?.version;
    Ok(status_now(&db, &build))
}

/// The same answer for the window and for the help pane.
pub fn status_now(db: &rusqlite::Connection, build: &str) -> StatusNow {
    StatusNow { status: index::status(db, build), wrote: WROTE.load(std::sync::atomic::Ordering::Relaxed) }
}

/// The install every command in this process reads, resolved once and cached
/// in `Chosen`. Never scans the disk itself — that is `install::Cache`'s job,
/// and only the version picker asks it to. The same `Chosen` and `Cache` the
/// localhost server reads, so the window and the F1 pane agree.
pub fn current(
    db: &rusqlite::Connection,
    chosen: &install::Chosen,
    cache: &install::Cache,
) -> Result<install::Install, String> {
    let wanted = db::get_setting(db, install::BUILD_KEY);
    let picked = install::resolve(chosen, cache, wanted.as_deref())?;
    // A fallback taken once is not taken again.
    if wanted.as_deref() != Some(picked.version.as_str()) {
        let _ = db::set_setting(db, install::BUILD_KEY, &picked.version);
    }
    Ok(picked)
}

/// The newest pass asked for, by number. An older pass that sees a newer
/// number stops at its next write, so a build switch or a reset never waits
/// for a pass the reader has left.
static PASS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// Held for the length of a pass: two passes never write at once.
static WRITING: Mutex<()> = Mutex::new(());
/// True once a pass in this process has written a page. `index_status` hands
/// it to the window, which reads the title list again when it sees it.
static WROTE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Starts the index pass for one build, reporting to the front-end as it
/// goes. `reset` empties the whole index first. The pass itself is
/// `engine::index`; the events are this app's.
pub fn start_index(app: tauri::AppHandle, data: std::path::PathBuf, install: install::Install, reset: bool) {
    use std::sync::atomic::Ordering::SeqCst;
    let mine = PASS.fetch_add(1, SeqCst) + 1;
    std::thread::spawn(move || {
        let live = || PASS.load(SeqCst) == mine;
        let writing = WRITING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if !live() {
            return;
        }
        if reset && let Err(message) = engine::db::open(&data).and_then(|db| engine::db::reset(&db)) {
            crate::say!(Error, "index", "reset failed: {message}");
            let _ = app.emit("index-failed", message);
            return;
        }
        let started = std::time::Instant::now();
        crate::say!(Info, "index", "pass {mine} starting for {}{}", install.version, if reset { ", after a reset" } else { "" });
        // A build already indexed reports `done` at once; only a pass that
        // reported progress first did any work worth timing.
        let worked = std::sync::atomic::AtomicBool::new(false);
        let report = |status: index::Status| {
            if !status.done {
                worked.store(true, std::sync::atomic::Ordering::Relaxed);
                WROTE.store(true, std::sync::atomic::Ordering::Relaxed);
            } else if worked.load(std::sync::atomic::Ordering::Relaxed) {
                crate::say!(Info, "index", "pass {mine} wrote {} pages in {:.1} s", status.pages, started.elapsed().as_secs_f64());
                telemetry::index_done(&app, started.elapsed().as_secs_f64(), status.pages);
            } else {
                // Nothing was written, so nothing on screen is out of date.
                crate::say!(Info, "index", "pass {mine} had nothing to do: {} pages already in", status.pages);
                return;
            }
            if live() {
                let _ = app.emit("index", status);
            }
        };
        if let Err(message) = index::run(&data, &install, &report, &live) {
            crate::say!(Error, "index", "pass {mine} failed: {message}");
            let _ = app.emit("index-failed", message);
        }
        if !live() {
            crate::say!(Info, "index", "pass {mine} dropped for a newer one");
        }
        // Outside the lock: a reset asked for now must not wait for this.
        drop(writing);
        if live() {
            engine::listing::warm(&install.help_roots());
        }
    });
}

/// The same resolution, off an `AppHandle` — what the `hicon`/`himage` URI
/// scheme handlers get instead of a `State`.
fn current_for(app: &tauri::AppHandle) -> Result<install::Install, String> {
    let db = app.state::<Db>();
    let db = db.0.lock().map_err(|e| e.to_string())?;
    current(&db, &app.state::<Arc<install::Chosen>>(), &app.state::<Arc<install::Cache>>())
}

/// Serves the pictures and videos a help page shows, out of the install.
/// The front-end asks for `himage://localhost/images/shelf/copy.jpg` or
/// `himage://localhost/videos/tween.webm`; `assets::resolve` wrote that path.
fn asset_response(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let name = percent_decode(request.uri().path());
    let bytes = match current_for(app).and_then(|install| help::asset_layered(&install.help_roots(), &name)) {
        Ok(bytes) => bytes,
        Err(reason) => {
            return Response::builder()
                .status(404)
                .body(reason.into_bytes())
                .unwrap()
        }
    };
    let head = Response::builder()
        .header("Content-Type", media_type(&name))
        .header("Cache-Control", "max-age=31536000")
        // The page reads a picture's pixels to choose its ground (lib/ground.ts),
        // and the window is another origin.
        .header("Access-Control-Allow-Origin", "*")
        .header("Accept-Ranges", "bytes");

    // A player asks for a range as soon as the reader drags the scrub bar, and
    // it takes the whole file as an answer that it cannot seek in.
    let asked = request.headers().get("Range").and_then(|v| v.to_str().ok());
    match range(asked, bytes.len()) {
        Some((first, last)) => head
            .status(206)
            .header(
                "Content-Range",
                format!("bytes {first}-{last}/{}", bytes.len()),
            )
            .body(bytes[first..=last].to_vec())
            .unwrap(),
        None => head.body(bytes).unwrap(),
    }
}

/// The bytes a `Range: bytes=first-last` header asks for, clamped to the file.
/// `None` for no header, for a form this app does not serve, and for a range
/// that starts past the end — the last of which is a 416 the player recovers
/// from by asking again, so answering with the whole file is the kinder reply.
pub fn range(header: Option<&str>, len: usize) -> Option<(usize, usize)> {
    let (first, last) = header?.trim().strip_prefix("bytes=")?.split_once('-')?;
    let first: usize = first.trim().parse().ok()?;
    let last = match last.trim() {
        "" => len.checked_sub(1)?,
        last => last.parse::<usize>().ok()?.min(len.checked_sub(1)?),
    };
    (first <= last).then_some((first, last))
}

/// The one media-type table. The `himage` handler serves pictures alone, where
/// anything unnamed is a JPEG; the localhost server also serves the built app,
/// and a browser refuses a module script that arrives as a picture.
pub(crate) fn media_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "map" => "application/json",
        "woff2" => "font/woff2",
        "ico" => "image/x-icon",
        "png" => "image/png",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        _ => "image/jpeg",
    }
}

/// Serves the icons the help pages name, straight out of `icons.zip`.
/// The front-end asks for `hicon://localhost/SOP/box.svg`.
fn icon_response(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let name = request.uri().path().trim_start_matches('/').to_string();
    let name = percent_decode(&name);
    match current_for(app).and_then(|install| help::icon_layered(&install.root, &install.packages, &name)) {
        Ok(bytes) => Response::builder()
            .header("Content-Type", "image/svg+xml")
            .header("Cache-Control", "max-age=31536000")
            .body(bytes)
            .unwrap(),
        Err(reason) => Response::builder()
            .status(404)
            .body(reason.into_bytes())
            .unwrap(),
    }
}

/// Answers a scheme request off the main thread. A synchronous handler runs on
/// the thread that draws the window, so every icon in a list waited behind the
/// page read in front of it, and the rows drew empty.
fn off_main(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
    answer: fn(&tauri::AppHandle, Request<Vec<u8>>) -> Response<Vec<u8>>,
) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || responder.respond(answer(&app, request)));
}

/// A help icon name can carry a space, so the webview sends it percent-encoded.
pub(crate) fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match (bytes[i], bytes.get(i + 1), bytes.get(i + 2)) {
            (b'%', Some(a), Some(b)) => match u8::from_str_radix(&format!("{}{}", *a as char, *b as char), 16) {
                Ok(byte) => {
                    out.push(byte);
                    i += 3;
                }
                Err(_) => {
                    out.push(bytes[i]);
                    i += 1;
                }
            },
            _ => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Whether the app was started with `--clean`: no index, no bookmarks, no
/// recents — what the first run looks like. The front end asks for this too,
/// because what the reader kept lives in the webview and not on disk here.
#[tauri::command]
fn clean_start() -> bool {
    std::env::args().any(|argument| argument == "--clean")
}

/// Throws away everything derived from the Houdini install and reads it again.
/// Nothing of the reader's is in these tables — see `db.rs` — so this costs a
/// pass and no more. Returns at once: the emptying is the pass's first step,
/// on the pass's thread, so the click is answered before the work begins.
#[tauri::command(async)]
fn reset_index(
    app: tauri::AppHandle,
    data: State<DataDir>,
    state: State<Db>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
) -> Result<(), String> {
    let install = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        current(&db, &chosen, &cache)?
    };
    start_index(app, data.0.clone(), install, true);
    Ok(())
}

/// Throws away the reader's own work: bookmarks, recent pages, and every
/// setting — which includes the build they chose and the fact that they have
/// run the onboarding. The window that asked for it reloads into a first
/// launch.
#[tauri::command]
fn reset_user_data(state: State<Db>) -> Result<(), String> {
    let db = state.0.lock().map_err(|e| e.to_string())?;
    db.execute_batch(
        "DELETE FROM user.bookmarks; DELETE FROM user.recents; DELETE FROM user.settings;",
    )
    .map_err(|e| e.to_string())
}

/// Every Houdini release series on this machine, and whether F1 already points
/// here. The onboarding step draws this list.
#[tauri::command]
fn houdini_releases(state: State<Port>, cache: State<Arc<install::Cache>>) -> Vec<hook::Release> {
    hook::releases(state.0, &installed(&cache))
}

/// The builds on this machine, as the version picker lists them.
fn installed(cache: &install::Cache) -> Vec<String> {
    cache.get().into_iter().map(|install| install.version).collect()
}

/// Turns F1 towards this app for the named releases. Idempotent, so onboarding
/// can call it again without asking whether it ran before.
#[tauri::command]
fn hook_houdini(
    data: State<DataDir>,
    state: State<Port>,
    releases: Vec<String>,
) -> Result<Vec<String>, String> {
    hook::apply(&data.0, state.0, &releases)
}

/// Turns F1 towards this app for the release series the reader's own build
/// belongs to. What the onboarding step asks for: the reader chose a build on
/// the step before, and the hook follows that choice rather than every Houdini
/// on the machine.
#[tauri::command]
fn hook_current_build(
    data: State<DataDir>,
    state: State<Db>,
    port: State<Port>,
    chosen: State<Arc<install::Chosen>>,
    cache: State<Arc<install::Cache>>,
) -> Result<Vec<String>, String> {
    let install = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        current(&db, &chosen, &cache)?
    };
    hook::apply(&data.0, port.0, &[hook::series_of(&install.version)])
}

/// The agents on this machine that Houdini MCP can connect to.
#[tauri::command]
fn mcp_agents() -> Vec<mcp::Agent> {
    mcp::agents()
}

/// Installs Houdini MCP for the release series of the reader's own build and
/// for one agent. The onboarding does not wait on it: the download runs off
/// the main thread, and the answer comes back whenever it is done.
#[tauri::command]
async fn install_houdini_mcp(
    state: State<'_, Db>,
    chosen: State<'_, Arc<install::Chosen>>,
    cache: State<'_, Arc<install::Cache>>,
    agent: String,
) -> Result<(), String> {
    let install = {
        let db = state.0.lock().map_err(|e| e.to_string())?;
        current(&db, &chosen, &cache)?
    };
    let release = hook::series_of(&install.version);
    // Settings reads the agent's config back to say what is installed.
    tauri::async_runtime::spawn_blocking(move || mcp::install(&release, &agent))
        .await
        .map_err(|e| e.to_string())?
}

/// Puts back what F1 pointed at before this app touched it, for the named
/// releases.
#[tauri::command]
fn unhook_houdini(data: State<DataDir>, releases: Vec<String>) -> Result<Vec<String>, String> {
    hook::revert(&data.0, &releases)
}

/// `--hook` turns F1 towards this app for every release series on the
/// machine. It takes the port the server just took, so the app is already
/// serving when the preference names it. `--unhook` is in `run`.
fn hook_from_the_command_line(data: &std::path::Path, port: u16, cache: &install::Cache) {
    if !std::env::args().any(|argument| argument == "--hook") {
        return;
    }
    let all: Vec<String> = hook::releases(port, &installed(cache)).into_iter().map(|r| r.release).collect();
    match hook::apply(data, port, &all) {
        Ok(releases) => println!("houdini {}", releases.join(", ")),
        Err(reason) => eprintln!("{reason}"),
    }
}

/// The installer registers the link scheme on Windows, but an AppImage has
/// no installer, and a moved AppImage leaves a registration that names the old
/// path. So every launch points the scheme at this executable. Not in a debug
/// build: `bun run app` would take the scheme from the installed app.
fn register_link_scheme(app: &tauri::App) {
    #[cfg(all(not(debug_assertions), any(windows, target_os = "linux")))]
    {
        use tauri_plugin_deep_link::DeepLinkExt;
        if let Err(reason) = app.deep_link().register_all() {
            crate::say!(Warn, "link", "the link scheme did not register: {reason}");
        }
    }
    let _ = app;
}

/// The port the localhost server took, so the front-end can show it and the
/// hook commands can write it. Zero where the server did not start.
struct Port(u16);

pub fn run() {
    let context = tauri::generate_context!();
    // The uninstaller asks for this, and the app can still be open then. So it
    // runs before the single-instance plugin can hand it to that app, and it
    // opens no window. The exit code tells the uninstaller to ask again.
    if std::env::args().any(|argument| argument == "--unhook") {
        let done = update::data_dir_before_launch(&context.config().identifier)
            .map_err(|e| e.to_string())
            .and_then(|data| hook::revert(&data, &[]));
        std::process::exit(if done.is_ok() { 0 } else { 1 });
    }
    let builder = tauri::Builder::default();
    // One process owns the port Houdini's F1 points at, so a second launch
    // hands over to the first. It must be the first plugin. A debug build
    // skips it: `bun run app` must start even while the installed app sits in
    // the tray, and the two share an identifier.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _| tray::second_launch(app, argv)));
    builder
        // `nodebookmd://docs/<slug>`, the link on the site's notice. The page
        // routes it (`DeepLinks` in `main.tsx`); a second launch that carries
        // one shows the window through `tray::second_launch`.
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(update::plugin())
        .register_asynchronous_uri_scheme_protocol("hicon", |ctx, request, responder| off_main(ctx.app_handle(), request, responder, icon_response))
        .register_asynchronous_uri_scheme_protocol("himage", |ctx, request, responder| off_main(ctx.app_handle(), request, responder, asset_response))
        .setup(|app| {
            // `--clean` runs the app as a machine that has never run it: its
            // own data directory beside the real one, which is left untouched.
            let data = if clean_start() {
                let fresh = std::env::temp_dir().join(format!("houdinimd-clean-{}", std::process::id()));
                std::fs::create_dir_all(&fresh)?;
                fresh
            } else {
                update::data_dir(app)?
            };
            log::start(&data, env!("CARGO_PKG_VERSION"));
            telemetry::catch_panics(data.clone());
            app.manage(telemetry::Telemetry::new(data.clone()));
            app.manage(Db(Mutex::new(db::open(&data)?)));
            let chosen = Arc::new(install::Chosen::new());
            let cache = Arc::new(install::Cache::new());
            app.manage(chosen.clone());
            app.manage(cache.clone());
            app.manage(DataDir(data.clone()));
            {
                let db = app.state::<Db>();
                let db = db.0.lock().map_err(|e| e.to_string())?;
                install::load_picked(
                    &cache,
                    &db::get_setting(&db, install::PICKED_KEY).unwrap_or_default(),
                );
            }
            // The server is what makes F1 work, so it starts whether or not
            // any Houdini is hooked yet. A reader who never hooks one pays a
            // thread and a socket for it. It reads the same `chosen` and
            // `cache` as the window, not copies — see `server::start`.
            let port = match server::start(app.handle().clone(), data.clone(), chosen.clone(), cache.clone()) {
                Ok(port) => {
                    crate::say!(Info, "server", "listening on localhost:{port}");
                    port
                }
                Err(reason) => {
                    crate::say!(Error, "server", "did not start: {reason}");
                    0
                }
            };
            app.manage(Port(port));
            hook_from_the_command_line(&data, port, &cache);
            hook::refresh(&data);
            match current_for(&app.handle().clone()) {
                Ok(install) => {
                    crate::say!(Info, "install", "reading Houdini {} at {}", install.version, install.root.display());
                    start_index(app.handle().clone(), data, install, false);
                }
                Err(reason) => crate::say!(Warn, "install", "no build to read: {reason}"),
            }
            // After the state above: the page asks for it as soon as it loads.
            window(app, &app.config().app.windows[0])?.build()?;
            tray::build(app)?;
            register_link_scheme(app);
            telemetry::start(app.handle());
            // The window is hidden in `tauri.conf.json`. This shows it, after
            // the update check has had its say.
            update::start(app.handle());
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            installs,
            available_installs,
            current_install,
            select_install,
            add_install,
            server_port,
            user_name,
            clean_start,
            page,
            meta,
            link_preview,
            titles,
            search,
            index_status,
            recents,
            bookmarks,
            record_visit,
            forget_recent,
            toggle_bookmark,
            get_setting,
            set_setting,
            houdini_releases,
            hook_houdini,
            hook_current_build,
            unhook_houdini,
            mcp_agents,
            install_houdini_mcp,
            reset_index,
            reset_user_data,
            report_error,
            report_use,
            report_search,
            show_telemetry_log,
            show_logs,
            open_page,
            has_example,
            launch_example,
            save_page,
            send_to_obsidian,
            obsidian_vaults,
            new_window,
            close_window,
            open_devtools
        ])
        .build(context)
        .expect("error while running the application")
        .run(|app, event| {
            // macOS keeps the process when the window hides, and the Dock icon
            // is the reader's way back to it. A link reaches the running app
            // here, not as a second launch.
            #[cfg(target_os = "macos")]
            match &event {
                tauri::RunEvent::Reopen { .. } => tray::show(app),
                tauri::RunEvent::Opened { .. } => tray::link_opened(app),
                _ => {}
            }
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::range;

    #[test]
    fn a_range_names_the_bytes_it_wants() {
        assert_eq!(range(Some("bytes=0-99"), 500), Some((0, 99)));
        assert_eq!(range(Some(" bytes=100-199 "), 500), Some((100, 199)));
    }

    #[test]
    fn an_open_range_runs_to_the_end() {
        assert_eq!(range(Some("bytes=100-"), 500), Some((100, 499)));
    }

    #[test]
    fn a_range_past_the_end_stops_at_the_end() {
        assert_eq!(range(Some("bytes=0-9999"), 500), Some((0, 499)));
    }

    #[test]
    fn what_this_cannot_serve_becomes_the_whole_file() {
        assert_eq!(range(None, 500), None);
        // A suffix range, `the last 100 bytes`, which no player asks a local
        // source for.
        assert_eq!(range(Some("bytes=-100"), 500), None);
        assert_eq!(range(Some("bytes=600-700"), 500), None);
        assert_eq!(range(Some("items=0-9"), 500), None);
        assert_eq!(range(Some("bytes=0-0"), 0), None);
    }
}
