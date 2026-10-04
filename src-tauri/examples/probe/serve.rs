//! THE APP, MINUS THE WINDOW, SO THAT A BROWSER CAN DRIVE IT.
//!
//! The machine this repository is developed on has no interactive desktop: a
//! Tauri window opens with a handle of zero and nothing can click it. So the
//! front-end half of the harness drives the real bundle in a real browser
//! instead, and this server stands where Tauri's IPC normally stands.
//!
//! Everything it answers with is the SAME function the `#[tauri::command]`
//! wrappers call — `read_page`, `all_titles`, `find`, `help::asset`. No dump
//! file, no fixture, no second parser. What the browser measures is the app's
//! own work plus one localhost round trip, and the round trip is measured
//! separately (`ipc.overhead`) so it can be taken off.
//!
//! It serves `dist/` as well, with one script tag inserted that fills in
//! `window.__TAURI_INTERNALS__`. That is the whole difference between the
//! bundle a reader installs and the bundle the harness drives.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use houdinimd_lib::{all_titles, db, find, help, index, install, library, read_meta, read_page};
use rusqlite::Connection;

/// What `invoke` becomes in the browser. `page` and the rest keep their names,
/// so nothing in `src/` knows it is being measured.
const STUB: &str = r#"<script>
window.__TAURI_INTERNALS__ = {
  // What the window API reads before it asks anything. Without it the app
  // throws on the first render instead of drawing.
  metadata: {
    currentWindow: { label: "main" },
    currentWebview: { windowLabel: "main", label: "main" },
  },
  async invoke(command, args) {
    // There is no window here and no event loop behind it: the title bar
    // draws, and its buttons do nothing.
    if (command.startsWith("plugin:window|")) return command.endsWith("|is_maximized") ? false : null;
    // `listen` hands over the name of its callback; the poll below calls it.
    if (command === "plugin:event|listen") (window.__listeners ??= []).push(args);
    if (command.startsWith("plugin:event|")) return 0;
    const at = performance.now();
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(args ?? {})) {
      body.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }
    const response = await fetch(`/api/${command}?${body}`);
    const text = await response.text();
    (window.__ipc ??= []).push({ command, ms: performance.now() - at });
    if (!response.ok) throw JSON.parse(text);
    return JSON.parse(text);
  },
  convertFileSrc(path, scheme) {
    return `/${scheme === "hicon" ? "icon" : "asset"}/${path}`;
  },
  transformCallback(callback) {
    const name = `_cb_${Math.random().toString(36).slice(2)}`;
    window[name] = callback;
    return name;
  },
};
// The event plugin keeps its own global, and `listen()` calls into it when a
// component unmounts. Without it every unlisten throws, and the console fills
// with a failure the real runtime never has.
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
// The app pushes an `index` event for each report of the pass. Here the
// report is polled, and a change is pushed the same way, so the page sees a
// pass in progress as the window sees it.
{
  let last = null;
  setInterval(async () => {
    const status = await fetch("/api/index_status").then((r) => r.text()).catch(() => null);
    if (status === null || status === last) return;
    const first = last === null;
    last = status;
    if (first) return;
    for (const { event, handler } of window.__listeners ?? []) {
      if (event === "index") window[handler]?.({ event, id: 0, payload: JSON.parse(status) });
    }
  }, 250);
}
</script>
"#;

struct Serve {
    db: Mutex<Connection>,
    /// The picker switches it, as the app does.
    install: Mutex<install::Install>,
    data: PathBuf,
    dist: PathBuf,
}

/// Which pass is live, and the lock one writer holds, as in the app.
static PASS: AtomicU64 = AtomicU64::new(0);
static WRITING: Mutex<()> = Mutex::new(());
/// True once a pass here has written, as `WROTE` in the app: the page reads
/// it to know the title list it holds is older than the index.
static WROTE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The pass on a thread of its own, as the app runs it, so the browser can
/// watch it fill the index. `reset` empties the index first. A new pass stops
/// the one before it.
fn start_index(data: &Path, install: &install::Install, reset: bool) {
    let (data, install) = (data.to_path_buf(), install.clone());
    let mine = PASS.fetch_add(1, Ordering::SeqCst) + 1;
    std::thread::spawn(move || {
        let live = || PASS.load(Ordering::SeqCst) == mine;
        let _writing = WRITING.lock().unwrap_or_else(|e| e.into_inner());
        if !live() {
            return;
        }
        let done = match reset {
            true => engine::db::open(&data).and_then(|db| engine::db::reset(&db)),
            false => Ok(()),
        }
        .and_then(|()| index::run(&data, &install, &|_| WROTE.store(true, Ordering::Relaxed), &live));
        if let Err(reason) = done {
            eprintln!("{reason}");
        }
    });
}

/// Runs until killed. `dist` is the built front-end; build it first.
pub fn run(port: u16, data: &Path, dist: PathBuf) -> Result<(), String> {
    let install = install::find(&[])
        .into_iter()
        .next()
        .ok_or("no Houdini install on this machine")?;
    let connection = db::open(data)?;
    // This server keeps its own copy of the index. A build not yet in it is
    // filled behind the page, the way the app fills it.
    if !index::status(&connection, &install.version).done {
        start_index(data, &install, false);
    }
    let state = Serve {
        db: Mutex::new(connection),
        install: Mutex::new(install),
        data: data.to_path_buf(),
        dist,
    };
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    // The harness waits for this line before it opens a browser.
    println!("listening on http://127.0.0.1:{port}");
    std::io::stdout().flush().ok();
    for stream in listener.incoming().flatten() {
        // One request at a time, on purpose: two measurements that overlap are
        // two measurements of each other.
        //
        // A browser holds its connection open after the answer, and this loop
        // would then wait on a socket that sends nothing while every other
        // request queues behind it. The timeout gives the loop back.
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
        if let Err(reason) = answer(&state, stream) {
            eprintln!("{reason}");
        }
    }
    Ok(())
}

fn answer(state: &Serve, mut stream: TcpStream) -> Result<(), String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut line = String::new();
    if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
        return Ok(());
    }
    // Only `Range` is kept: a player asks for one to seek.
    let mut header = String::new();
    let mut asked = None;
    while reader.read_line(&mut header).map_err(|e| e.to_string())? > 2 {
        if let Some((name, value)) = header.split_once(':')
            && name.trim().eq_ignore_ascii_case("range")
        {
            asked = Some(value.trim().to_string());
        }
        header.clear();
    }
    let target = line.split_whitespace().nth(1).unwrap_or("/").to_string();
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let path = decode(path);

    let (status, kind, mut body) = route(state, &path, query);
    let whole = body.len();
    let mut part = String::new();
    let status = match (status, houdinimd_lib::range(asked.as_deref(), whole)) {
        (200, Some((first, last))) => {
            body = body[first..=last].to_vec();
            part = format!("Content-Range: bytes {first}-{last}/{whole}\r\n");
            206
        }
        (status, _) => status,
    };
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\n{part}Accept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(&body).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())
}

fn route(state: &Serve, path: &str, query: &str) -> (u16, &'static str, Vec<u8>) {
    let install = state.install.lock().unwrap().clone();
    if let Some(command) = path.strip_prefix("/api/") {
        return command_response(state, command, query);
    }
    if let Some(name) = path.strip_prefix("/asset/") {
        return match help::asset_layered(&install.help_roots(), name) {
            Ok(bytes) => (200, media_type(name), bytes),
            Err(reason) => (404, "text/plain", reason.into_bytes()),
        };
    }
    if let Some(name) = path.strip_prefix("/icon/") {
        return match help::icon_layered(&install.root, &install.packages, name) {
            Ok(bytes) => (200, "image/svg+xml", bytes),
            Err(reason) => (404, "text/plain", reason.into_bytes()),
        };
    }
    // The page as Markdown, the same as the app's own server answers it.
    if let Some(page) = path.strip_suffix(".md") {
        return match read_page(&install, page.trim_start_matches('/')) {
            Ok(view) => (200, "text/markdown; charset=utf-8", view.document().into_bytes()),
            Err(reason) => (404, "text/plain", reason.message.into_bytes()),
        };
    }
    file(state, path)
}

fn command_response(state: &Serve, command: &str, query: &str) -> (u16, &'static str, Vec<u8>) {
    let json = "application/json";
    let install = state.install.lock().unwrap().clone();
    let value = match command {
        // The event plugin is answered in the stub; see `STUB`.
        _ if command.starts_with("plugin:") => Ok("0".to_string()),
        "installs" => serde_json::to_string(&install::find(&[])).map_err(|e| e.to_string()),
        "user_name" => serde_json::to_string(&whoami()).map_err(|e| e.to_string()),
        // The harness always runs on the store the scene seeded, so the
        // browser build never starts clean.
        "clean_start" => Ok("false".to_string()),
        "index_status" => {
            let db = state.db.lock().map_err(|e| e.to_string()).unwrap();
            let status = index::status(&db, &install.version);
            serde_json::to_value(&status)
                .map(|mut json| {
                    json["wrote"] = WROTE.load(Ordering::Relaxed).into();
                    json.to_string()
                })
                .map_err(|e| e.to_string())
        }
        "titles" => {
            let db = state.db.lock().unwrap();
            all_titles(&db, &install.version)
                .and_then(|hits| serde_json::to_string(&hits).map_err(|e| e.to_string()))
        }
        "search" => {
            let db = state.db.lock().unwrap();
            let limit = param(query, "limit").and_then(|v| v.parse().ok()).unwrap_or(6);
            find(
                &db,
                &install.version,
                &param(query, "query").unwrap_or_default(),
                limit,
            )
            .and_then(|hits| serde_json::to_string(&hits).map_err(|e| e.to_string()))
        }
        "page" => {
            let path = param(query, "path").unwrap_or_default();
            match read_page(&install, &path) {
                Ok(mut page) => {
                    let db = state.db.lock().unwrap();
                    page.node_versions = engine::versions::of(&db, &install.version, &path);
                    serde_json::to_string(&page).map_err(|e| e.to_string())
                }
                Err(error) => {
                    let body = serde_json::to_string(&error).unwrap_or_default();
                    return (404, json, body.into_bytes());
                }
            }
        }
        // `meta` takes a list, which the stub joins with commas. It is the one
        // command whose arguments are not one value.
        "meta" => {
            let asked: Vec<String> = param(query, "paths")
                .unwrap_or_default()
                .split(',')
                .filter(|p| !p.is_empty())
                .map(String::from)
                .collect();
            read_meta(&state.db.lock().unwrap(), &install, &asked)
                .and_then(|meta| serde_json::to_string(&meta).map_err(|e| e.to_string()))
        }
        "has_example" => Ok(houdinimd_lib::example_file(&install, &param(query, "path").unwrap_or_default())
            .is_some()
            .to_string()),
        "link_preview" => tauri::async_runtime::block_on(houdinimd_lib::preview::fetch(
            &param(query, "url").unwrap_or_default(),
        ))
        .and_then(|preview| serde_json::to_string(&preview).map_err(|e| e.to_string())),
        // The build the app reads. The harness stands up one install and
        // lists the others, so the picker draws a build it could index.
        "current_install" => serde_json::to_string(&install).map_err(|e| e.to_string()),
        "available_installs" => {
            let db = state.db.lock().unwrap();
            let rows: Vec<_> = install::find(&[])
                .into_iter()
                .map(|other| {
                    let status = index::status(&db, &other.version);
                    serde_json::json!({
                        "version": other.version,
                        "pages": status.pages,
                        "done": status.done,
                        "current": other.version == install.version,
                    })
                })
                .collect();
            serde_json::to_string(&rows).map_err(|e| e.to_string())
        }
        "reset_index" => {
            start_index(&state.data, &install, true);
            Ok("null".to_string())
        }
        "select_install" => {
            let version = param(query, "version").unwrap_or_default();
            match install::find(&[]).into_iter().find(|i| i.version == version) {
                Some(chosen) => {
                    let status = index::status(&state.db.lock().unwrap(), &chosen.version);
                    if !status.done {
                        start_index(&state.data, &chosen, false);
                    }
                    *state.install.lock().unwrap() = chosen;
                    serde_json::to_string(&status).map_err(|e| e.to_string())
                }
                None => Err(format!("Houdini {version} is not on this machine")),
            }
        }
        // No localhost server stands behind the harness, so nothing is drawn
        // for it. Zero is what the front-end reads as "no server".
        "server_port" => Ok("0".to_string()),
        "recents" => {
            let db = state.db.lock().unwrap();
            library::recents(&db).and_then(|rows| serde_json::to_string(&rows).map_err(|e| e.to_string()))
        }
        "bookmarks" => {
            let db = state.db.lock().unwrap();
            library::bookmarks(&db).and_then(|rows| serde_json::to_string(&rows).map_err(|e| e.to_string()))
        }
        "record_visit" | "toggle_bookmark" => {
            let db = state.db.lock().unwrap();
            let entry = library::Entry {
                id: None,
                path: param(query, "path").unwrap_or_default(),
                title: param(query, "title").unwrap_or_default(),
                icon: param(query, "icon"),
                at: 0,
            };
            if command == "record_visit" {
                library::record_visit(&db, &entry).map(|id| id.to_string())
            } else {
                library::toggle_bookmark(&db, &entry)
                    .map(|kept| kept.to_string())
            }
        }
        "forget_recent" => {
            let db = state.db.lock().unwrap();
            library::forget(&db, param(query, "id").and_then(|v| v.parse().ok()).unwrap_or(-1))
                .map(|()| "null".to_string())
        }
        "get_setting" => {
            let db = state.db.lock().unwrap();
            serde_json::to_string(&db::get_setting(&db, &param(query, "key").unwrap_or_default()))
                .map_err(|e| e.to_string())
        }
        "set_setting" => {
            let db = state.db.lock().unwrap();
            db::set_setting(
                &db,
                &param(query, "key").unwrap_or_default(),
                &param(query, "value").unwrap_or_default(),
            )
            .map(|()| "null".to_string())
        }
        // Read-only, so the Settings screen draws. Nothing here hooks F1 or
        // installs the MCP: that would change the reader's real Houdini.
        "mcp_agents" => serde_json::to_string(&houdinimd_lib::mcp::agents()).map_err(|e| e.to_string()),
        "houdini_releases" => serde_json::to_string(&houdinimd_lib::hook::releases(0, &[install.version.clone()])).map_err(|e| e.to_string()),
        other => Err(format!("no command {other}")),
    };
    match value {
        Ok(body) => (200, json, body.into_bytes()),
        Err(reason) => (500, "text/plain", reason.into_bytes()),
    }
}

/// A file out of `dist/`. Anything that is not a file is the single page,
/// because the front-end routes on the hash and every route is `index.html`.
fn file(state: &Serve, path: &str) -> (u16, &'static str, Vec<u8>) {
    let wanted = state.dist.join(path.trim_start_matches('/'));
    if wanted.is_file() && wanted.starts_with(&state.dist) {
        let kind = media_type(path);
        return match std::fs::read(&wanted) {
            Ok(bytes) => (200, kind, bytes),
            Err(e) => (500, "text/plain", e.to_string().into_bytes()),
        };
    }
    let index = state.dist.join("index.html");
    let Ok(mut html) = std::fs::read_to_string(&index) else {
        return (
            404,
            "text/plain",
            format!("no {} — run `bun run build` first", index.display()).into_bytes(),
        );
    };
    html = match html.split_once("</head>") {
        Some((head, rest)) => format!("{head}{STUB}</head>{rest}"),
        None => format!("{STUB}{html}"),
    };
    (200, "text/html; charset=utf-8", html.into_bytes())
}

fn param(query: &str, name: &str) -> Option<String> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| decode(&value.replace('+', " ")))
}

fn media_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "gif" => "image/gif",
        "webm" => "video/webm",
        "mp4" => "video/mp4",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "image/jpeg",
    }
}

fn decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match (bytes[i], bytes.get(i + 1), bytes.get(i + 2)) {
            (b'%', Some(a), Some(b)) => {
                let pair = format!("{}{}", *a as char, *b as char);
                match u8::from_str_radix(&pair, 16) {
                    Ok(byte) => {
                        out.push(byte);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            _ => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The same answer the app's `user_name` command gives, so the greeting on
/// the landing page reads here the way it reads in the window.
fn whoami() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_default()
}
