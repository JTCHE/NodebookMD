//! Serves the app over HTTP, so F1 in Houdini opens it.
//!
//! Houdini's help window is QtWebEngine, a plain browser. It knows nothing of
//! the `hicon:` and `himage:` schemes the Tauri webview answers: a page that
//! names them shows a broken image and never asks the network. Tested with all
//! three side by side. So everything here is ordinary HTTP, and the front-end
//! asks `/api` for what it asks the desktop shell for through `invoke`.
//!
//! The server has its own database connection. A search in the help pane must
//! not wait on a search in the app window.
//!
//! Bookmarks, recents and settings write through this same `/api` GET, not a
//! POST: every other command already reads its arguments off the query
//! string, this is one reader on one machine with no cookie or session to
//! forge, and a write here is one `INSERT` — a POST route would only add a
//! second body-parsing path for the same trust level.

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use include_dir::{Dir, include_dir};
use rusqlite::Connection;
use tiny_http::{Header, Response, Server};

use crate::{db, help, index, install, library};

/// The built front-end, inside the binary, so the server has no files to find.
static APP: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../dist");

/// Houdini's own help server takes 48626 and walks upward from there, so start
/// clear of it.
pub const FIRST_PORT: u16 = 48800;

/// How many ports to try before giving up.
const TRIES: u16 = 20;

/// Starts the server on the first free port and answers on a thread of its own.
/// Returns the port it took, which is the port the hook writes into
/// `misc.externalhelpurl.val`.
///
/// `chosen` and `cache` are the same instances the desktop window reads, not
/// copies — a build switched in the window is a build this thread serves on
/// its very next request, and a folder picked by hand in the window is a
/// folder this thread's scan already knows about too.
pub fn start(
    app: tauri::AppHandle,
    data: PathBuf,
    chosen: Arc<install::Chosen>,
    cache: Arc<install::Cache>,
) -> Result<u16, String> {
    let (listener, port) = bind()?;
    let server = Server::from_listener(listener, None).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        // A cook must always win the core, the same as the index pass.
        index::background_priority();
        let db = db::open(&data).map(Mutex::new);
        for request in server.incoming_requests() {
            // A browser names the site of the page that sent a request. The
            // old Chromium in some Houdini builds sends no such header.
            let from_app = request
                .headers()
                .iter()
                .find(|header| header.field.equiv("Sec-Fetch-Site"))
                .map_or(true, |header| header.value.as_str() == "same-origin");
            // A preview waits on another site, so it answers on a thread of
            // its own: a slow site must not hold up a page read behind it.
            if let Some(query) = request.url().strip_prefix("/api/link_preview?") {
                let url = parse(query).url;
                std::thread::spawn(move || respond(request, link_preview(&url, from_app)));
                continue;
            }
            let answer = answer(&app, db.as_ref(), &chosen, &cache, request.url(), from_app);
            respond(request, answer);
        }
    });
    Ok(port)
}

fn respond(request: tiny_http::Request, (status, body, kind): Answer) {
    // What Houdini asked for, and what it got. Houdini's help window says
    // nothing when a page fails, so without this there is no way to tell a
    // wrong path from a wrong answer.
    #[cfg(debug_assertions)]
    eprintln!("{status} {} {}", request.method(), request.url());
    let header = |name: &str, value: &str| Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("a valid header");
    // A player asks for a range as soon as the reader drags the scrub bar, and
    // it takes the whole file as an answer that it cannot seek in.
    let asked = request.headers().iter().find(|h| h.field.equiv("Range")).map(|h| h.value.as_str());
    let part = if status == 200 { crate::range(asked, body.len()) } else { None };
    let mut response = match part {
        Some((first, last)) => Response::from_data(body[first..=last].to_vec())
            .with_status_code(206)
            .with_header(header("Content-Range", &format!("bytes {first}-{last}/{}", body.len()))),
        None => Response::from_data(body).with_status_code(status),
    };
    response.add_header(header("Content-Type", kind));
    response.add_header(header("Accept-Ranges", "bytes"));
    let _ = request.respond(response);
}

/// Only for the app's own page, the same as `open_url`: another site the
/// reader visits must not make this machine fetch addresses for it.
fn link_preview(url: &str, from_app: bool) -> Answer {
    if !from_app {
        return (403, b"only the app asks for a preview".to_vec(), "text/plain");
    }
    match tauri::async_runtime::block_on(crate::preview::fetch(url)).and_then(|preview| ser(&preview)) {
        Ok(body) => (200, body, "application/json"),
        Err(reason) => (502, reason.into_bytes(), "text/plain"),
    }
}

/// The first free port at or above `FIRST_PORT`. Bound to the network as well
/// as to loopback: a phone on the same network is the only phone access the
/// local app has, and the hook still writes `http://localhost:<port>/`.
fn bind() -> Result<(TcpListener, u16), String> {
    for port in FIRST_PORT..FIRST_PORT + TRIES {
        let address = SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port);
        if let Ok(listener) = TcpListener::bind(address) {
            return Ok((listener, port));
        }
    }
    Err(format!(
        "no free port between {FIRST_PORT} and {}",
        FIRST_PORT + TRIES
    ))
}

type Answer = (u16, Vec<u8>, &'static str);

/// One request, answered: status, body, media type.
fn answer(
    app: &tauri::AppHandle,
    db: Result<&Mutex<Connection>, &String>,
    chosen: &install::Chosen,
    cache: &install::Cache,
    url: &str,
    from_app: bool,
) -> Answer {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let path = crate::percent_decode(path);

    if path == "/api/open_url" {
        return open_url(&parse(query).url, from_app);
    }

    if let Some(name) = path.strip_prefix("/hicon/") {
        return match current(db, chosen, cache).and_then(|install| help::icon(&install.root, name)) {
            Ok(bytes) => (200, bytes, "image/svg+xml"),
            Err(reason) => not_found(reason),
        };
    }
    if let Some(name) = path.strip_prefix("/himage/") {
        return match current(db, chosen, cache).and_then(|install| help::asset(&install.help, name)) {
            Ok(bytes) => (200, bytes, crate::media_type(name)),
            Err(reason) => not_found(reason),
        };
    }
    if let Some(command) = path.strip_prefix("/api/") {
        report(app, command, &parse(query));
        return api(db, chosen, cache, command, query);
    }
    // `/nodes/sop/box.md` is the page as Markdown, for an agent that reads a
    // file and not an app. The "copy page path" keys hand out this address.
    if let Some(page) = path.strip_suffix(".md") {
        return match current(db, chosen, cache)
            .and_then(|i| crate::read_page(&i, page.trim_start_matches('/')).map_err(|e| e.message))
        {
            Ok(view) => (200, view.document().into_bytes(), "text/markdown; charset=utf-8"),
            Err(reason) => not_found(reason),
        };
    }
    file(&path)
}

/// The help pane is a real surface, so what a reader does there counts the
/// same as what they do in the window.
fn report(app: &tauri::AppHandle, command: &str, call: &Call) {
    match command {
        "report_use" if call.kind == "setup" || call.kind == "feature" => {
            crate::telemetry::track(app, &call.kind, &call.name)
        }
        "report_search" => crate::telemetry::search(app, call.hits, call.rank),
        _ => {}
    }
}

/// The same answers the desktop shell gives through `invoke`, so the front-end
/// has one set of calls and not two. `backend.ts` picks which door to knock on.
fn api(
    db: Result<&Mutex<Connection>, &String>,
    chosen: &install::Chosen,
    cache: &install::Cache,
    command: &str,
    query: &str,
) -> Answer {
    let call = parse(query);
    let json = match command {
        "installs" => serde_json::to_vec(&if call.refresh { cache.refresh() } else { cache.get() }),
        // The pane reads the build the same way the window does. Which
        // Houdini pressed F1 decided it; the card there is a label, but the
        // label still has to name the right build.
        "current_install" => match current(db, chosen, cache) {
            Ok(install) => serde_json::to_vec(&install),
            Err(reason) => return not_found(reason),
        },
        "user_name" => serde_json::to_vec(&crate::user_name_of_this_machine()),
        // `report` already sent these.
        "report_use" | "report_search" => serde_json::to_vec(&true),
        "clean_start" => serde_json::to_vec(&false),
        "page" => match current(db, chosen, cache).and_then(|i| {
            // A missing page goes back whole, as `invoke` gives it: the
            // `missing` flag is what draws the not-found page in the pane.
            let mut page = crate::read_page(&i, &call.path).map_err(|e| match e.missing {
                true => serde_json::to_string(&e).unwrap_or(e.message),
                false => e.message,
            })?;
            page.node_versions = db
                .ok()
                .and_then(|db| db.lock().ok())
                .map(|db| engine::versions::of(&db, &i.version, &call.path))
                .unwrap_or_default();
            Ok(page)
        }) {
            Ok(page) => serde_json::to_vec(&page),
            Err(reason) => return not_found(reason),
        },
        "titles" | "search" | "meta" | "index_status" => return indexed(db, chosen, cache, command, &call),
        "recents" | "bookmarks" | "record_visit" | "forget_recent" | "toggle_bookmark" | "get_setting"
        | "set_setting" => return user_data(db, command, &call),
        _ => return not_found(format!("no command {command}")),
    };
    match json {
        Ok(body) => (200, body, "application/json"),
        Err(reason) => (500, reason.to_string().into_bytes(), "text/plain"),
    }
}

/// The commands that read the index. Held apart because they all need the same
/// two things first: the connection, and the build.
fn indexed(
    db: Result<&Mutex<Connection>, &String>,
    chosen: &install::Chosen,
    cache: &install::Cache,
    command: &str,
    call: &Call,
) -> Answer {
    let db = match db {
        Ok(db) => db,
        Err(reason) => return (500, reason.clone().into_bytes(), "text/plain"),
    };
    let db = match db.lock() {
        Ok(db) => db,
        Err(_) => return (500, b"the index is unreadable".to_vec(), "text/plain"),
    };
    let install = match crate::current(&db, chosen, cache) {
        Ok(install) => install,
        Err(reason) => return not_found(reason),
    };
    let build = &install.version;
    let json = match command {
        "titles" => crate::all_titles(&db, build).and_then(|hits| ser(&hits)),
        "search" => crate::find(&db, build, &call.query, call.limit).and_then(|hits| ser(&hits)),
        "meta" => crate::read_meta(&db, &install, &call.paths).and_then(|meta| ser(&meta)),
        _ => ser(&crate::status_now(&db, build)),
    };
    match json {
        Ok(body) => (200, body, "application/json"),
        Err(reason) => (500, reason.into_bytes(), "text/plain"),
    }
}

/// The reader's own data: bookmarks, recents, settings. Never keyed by build,
/// so it needs the connection and nothing else. See spec: Local — User config
/// shared between the window and the help pane.
fn user_data(db: Result<&Mutex<Connection>, &String>, command: &str, call: &Call) -> Answer {
    let db = match db {
        Ok(db) => db,
        Err(reason) => return (500, reason.clone().into_bytes(), "text/plain"),
    };
    let db = match db.lock() {
        Ok(db) => db,
        Err(_) => return (500, b"the index is unreadable".to_vec(), "text/plain"),
    };
    let entry = || library::Entry {
        id: None,
        path: call.path.clone(),
        title: call.title.clone(),
        icon: call.icon.clone(),
        at: call.at,
    };
    let json = match command {
        "recents" => library::recents(&db).and_then(|v| ser(&v)),
        "bookmarks" => library::bookmarks(&db).and_then(|v| ser(&v)),
        "record_visit" => library::record_visit(&db, &entry()).and_then(|id| ser(&id)),
        "forget_recent" => library::forget(&db, call.id).and_then(|()| ser(&())),
        "toggle_bookmark" => library::toggle_bookmark(&db, &entry()).and_then(|kept| ser(&kept)),
        "get_setting" => Ok(db::get_setting(&db, &call.key)).and_then(|v| ser(&v)),
        "set_setting" => db::set_setting(&db, &call.key, &call.value).and_then(|()| ser(&())),
        _ => unreachable!("filtered by the caller"),
    };
    match json {
        Ok(body) => (200, body, "application/json"),
        Err(reason) => (500, reason.into_bytes(), "text/plain"),
    }
}

/// Houdini's help pane opens no window for a link that asks for one, so the
/// pane sends an outside link here and the reader's own browser opens it.
/// Only for the app's own page: a page on another site gets a refusal, or any
/// site the reader visits could open tabs on this machine.
fn open_url(url: &str, from_app: bool) -> Answer {
    if !from_app {
        return (403, b"only the app opens links".to_vec(), "text/plain");
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return (400, b"only a web address opens".to_vec(), "text/plain");
    }
    match tauri_plugin_opener::open_url(url, None::<&str>) {
        Ok(()) => (200, b"null".to_vec(), "application/json"),
        Err(reason) => (500, reason.to_string().into_bytes(), "text/plain"),
    }
}

fn ser<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|e| e.to_string())
}

fn not_found(reason: String) -> Answer {
    (404, reason.into_bytes(), "text/plain")
}

/// One built file, or the app itself for a page path.
///
/// F1 on the Box SOP asks for `/nodes/sop/box`, which is not a file: the app
/// routes it once it is running, so every page path is answered with the app.
/// A name with a dot in it is a file that is missing, not a page — `favicon.ico`
/// is the one Houdini asks for after every navigation, and answering it with
/// the app would draw a broken icon.
fn file(path: &str) -> Answer {
    let name = path.trim_start_matches('/');
    if let Some(found) = APP.get_file(name) {
        return (200, found.contents().to_vec(), crate::media_type(name));
    }
    if name.rsplit('/').next().unwrap_or_default().contains('.') {
        return not_found(format!("no {name} in this build"));
    }
    match APP.get_file("index.html") {
        Some(index) => (200, index.contents().to_vec(), "text/html; charset=utf-8"),
        None => (
            500,
            b"the app was not built into this binary".to_vec(),
            "text/plain",
        ),
    }
}

/// What the front-end asked the command for. Both a read and a write travel
/// as a query string here — see the module comment for why a POST is not
/// worth it on a single-user localhost server.
#[derive(Default)]
struct Call {
    path: String,
    query: String,
    limit: u32,
    /// `meta` asks about a batch of links at once, comma separated.
    paths: Vec<String>,
    refresh: bool,
    title: String,
    icon: Option<String>,
    at: i64,
    /// Which visit `forget_recent` drops.
    id: i64,
    key: String,
    value: String,
    /// The outside link `open_url` opens.
    url: String,
    /// What the telemetry calls carry.
    kind: String,
    name: String,
    hits: u32,
    rank: i32,
}

fn parse(query: &str) -> Call {
    let mut call = Call {
        limit: 20,
        ..Call::default()
    };
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else {
            continue;
        };
        let value = crate::percent_decode(&value.replace('+', " "));
        match key {
            "path" => call.path = value,
            "query" => call.query = value,
            "limit" => call.limit = value.parse().unwrap_or(20),
            "paths" => call.paths = value.split(',').map(str::to_string).collect(),
            "refresh" => call.refresh = value == "true",
            "title" => call.title = value,
            "icon" if !value.is_empty() => call.icon = Some(value),
            "at" => call.at = value.parse().unwrap_or(0),
            "id" => call.id = value.parse().unwrap_or(0),
            "key" => call.key = value,
            "value" => call.value = value,
            "url" => call.url = value,
            "kind" => call.kind = value,
            "name" => call.name = value,
            "hits" => call.hits = value.parse().unwrap_or(0),
            "rank" => call.rank = value.parse().unwrap_or(-1),
            _ => {}
        }
    }
    call
}

/// The install this thread reads. `chosen` is the same `Arc` the desktop
/// shell's own `current` in `lib.rs` reads, so this and the window always
/// agree on the build, even mid-session after a switch.
fn current(
    db: Result<&Mutex<Connection>, &String>,
    chosen: &install::Chosen,
    cache: &install::Cache,
) -> Result<install::Install, String> {
    let db = db.map_err(String::clone)?;
    let db = db.lock().map_err(|_| "the index is unreadable".to_string())?;
    crate::current(&db, chosen, cache)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_query_names_what_the_command_needs() {
        let call = parse("path=nodes%2Fsop%2Fbox&limit=8");
        assert_eq!(call.path, "nodes/sop/box");
        assert_eq!(call.limit, 8);
    }

    #[test]
    fn a_batch_of_links_comes_as_one_list() {
        let call = parse("paths=nodes/sop/box,vex/functions/noise");
        assert_eq!(call.paths, ["nodes/sop/box", "vex/functions/noise"]);
    }

    #[test]
    fn a_search_keeps_its_spaces() {
        assert_eq!(parse("query=copy+to+points").query, "copy to points");
    }

    #[test]
    fn a_help_path_gets_the_app_that_routes_it() {
        // What F1 on the Box SOP asks for. Anything else leaves Houdini's pane
        // blank.
        let (status, _, kind) = file("/nodes/sop/box");
        assert_eq!(status, 200);
        assert_eq!(kind, "text/html; charset=utf-8");
    }

    #[test]
    fn a_missing_file_stays_missing() {
        // Houdini asks for this after every navigation. Answering it with the
        // app would draw a broken icon.
        assert_eq!(file("/favicon.ico").0, 404);
    }

    #[test]
    fn the_root_is_the_app_itself() {
        assert_eq!(file("/").0, 200);
    }

    fn temp_db() -> Result<Mutex<Connection>, String> {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let data = std::env::temp_dir()
            .join(format!("houdinimd-server-test-{}-{n}", std::process::id()));
        Ok(Mutex::new(db::open(&data)?))
    }

    /// The same round trip Houdini's help pane makes: bookmark a page over
    /// `/api`, then read it back, all through GET. This is the path the
    /// window-vs-pane bug lived on, so it is the one worth a real request.
    #[test]
    fn a_bookmark_written_over_the_api_reads_back_over_the_api() {
        let db = temp_db().unwrap();
        let chosen = install::Chosen::new();
        let cache = install::Cache::new();

        let (status, _, _) = api(
            Ok(&db),
            &chosen,
            &cache,
            "toggle_bookmark",
            "path=nodes%2Fsop%2Fbox&title=Box&at=1",
        );
        assert_eq!(status, 200);

        let (status, body, kind) = api(Ok(&db), &chosen, &cache, "bookmarks", "");
        assert_eq!(status, 200);
        assert_eq!(kind, "application/json");
        let read: Vec<library::Entry> = serde_json::from_slice(&body).unwrap();
        assert_eq!(read.len(), 1);
        assert_eq!(read[0].path, "nodes/sop/box");
    }

    #[test]
    fn a_setting_written_over_the_api_reads_back_over_the_api() {
        let db = temp_db().unwrap();
        let chosen = install::Chosen::new();
        let cache = install::Cache::new();

        api(Ok(&db), &chosen, &cache, "set_setting", "key=build&value=22.0.368");
        let (_, body, _) = api(Ok(&db), &chosen, &cache, "get_setting", "key=build");
        let read: Option<String> = serde_json::from_slice(&body).unwrap();
        assert_eq!(read.as_deref(), Some("22.0.368"));
    }
}
