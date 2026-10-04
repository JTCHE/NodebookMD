//! Anonymous usage data, sent only when the reader said yes.
//!
//! What goes out, and nothing else: a random id made on this machine, the app
//! version, the Houdini build, the operating system version, how long an index
//! pass took, how long pages take to open, how many rows a search returned
//! and which row was opened, which answers the first launch got,
//! the names of the parts of the app a session used, crash messages, and a
//! bare "alive" once an hour while the app runs. Each
//! name is a fixed word this code writes. No page path,
//! no title, no search, no user name, no file path. Every payload is also
//! written to `telemetry.log` in the data folder before it is sent, so the
//! reader can read exactly what left the machine.
//! See spec: Opt-in Anonymous Telemetry. The receiving end is `telemetry/`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

const ENDPOINT: &str = "https://telemetry.nodebook.md/v1/event";
/// The onboarding writes `true` or `false` here. Absent means the reader has
/// not answered yet, and nothing is sent.
pub const KEY: &str = "telemetry";
const ID_KEY: &str = "telemetry_id";
const LOG: &str = "telemetry.log";
/// Written by the panic hook, sent and removed by the next launch. A panic
/// aborts the process (`panic = "abort"`), so there is no later moment to
/// send it in.
const CRASH: &str = "crash.txt";
/// How often a running app says it is still running. It carries the same
/// fields as `launch` and nothing more; it is what lets the dashboard count
/// installs open now, not only installs that launched lately.
const HEARTBEAT: Duration = Duration::from_secs(60 * 60);
/// Page opens are sent as one summary per this many, not one event each.
const BATCH: usize = 25;

pub struct Telemetry {
    data: PathBuf,
    opens: Mutex<Vec<f64>>,
    errors: Mutex<Vec<String>>,
    features: Mutex<Vec<String>>,
}

impl Telemetry {
    pub fn new(data: PathBuf) -> Self {
        Self {
            data,
            opens: Mutex::new(Vec::new()),
            errors: Mutex::new(Vec::new()),
            features: Mutex::new(Vec::new()),
        }
    }
}

/// Writes what a panic says to `crash.txt`, then lets the default hook run.
pub fn catch_panics(data: PathBuf) {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let text = format!("{} {info}", env!("CARGO_PKG_VERSION"));
        crate::say!(Error, "crash", "{info}");
        let _ = std::fs::write(data.join(CRASH), &text);
        default(info);
    }));
}

/// At launch: the crash from last time, if any, then the launch itself.
pub fn start(app: &AppHandle) {
    let data = app.state::<Telemetry>().data.clone();
    let log = data.join(LOG);
    // The log is for reading, not for keeping: one older file is enough.
    if std::fs::metadata(&log).is_ok_and(|m| m.len() > 256 * 1024) {
        let _ = std::fs::rename(&log, data.join(format!("{LOG}.old")));
    }
    if let Ok(crash) = std::fs::read_to_string(data.join(CRASH)) {
        send(app, "crash", json!({ "message": clip(&crash) }));
        let _ = std::fs::remove_file(data.join(CRASH));
    }
    send(app, "launch", json!({}));
    // `send` reads the consent on every beat, so turning usage data off stops
    // the beats at once.
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(HEARTBEAT);
        send(&app, "alive", json!({}));
    });
}

/// One index pass that did work, and how long it took.
pub fn index_done(app: &AppHandle, seconds: f64, pages: u32) {
    send(app, "index", json!({ "seconds": seconds, "pages": pages }));
}

/// One page open, measured around the read and the parse.
pub fn page_opened(app: &AppHandle, ms: f64) {
    let state = app.state::<Telemetry>();
    let Ok(mut opens) = state.opens.lock() else { return };
    opens.push(ms);
    if opens.len() < BATCH {
        return;
    }
    let mut sorted = std::mem::take(&mut *opens);
    drop(opens);
    sorted.sort_by(f64::total_cmp);
    let at = |share: f64| sorted[((sorted.len() - 1) as f64 * share).round() as usize];
    send(app, "pages", json!({ "count": sorted.len(), "median_ms": at(0.5), "p95_ms": at(0.95) }));
}

/// A named thing happened. `kind` is `setup` (the first launch ended, and the
/// answers it got) or `feature` (a part of the app was used). The pair is sent
/// once per launch, so a count is sessions that did it, not presses. `name` is
/// a fixed word the code writes, never something the reader typed.
pub fn track(app: &AppHandle, kind: &str, name: &str) {
    {
        let state = app.state::<Telemetry>();
        let Ok(mut seen) = state.features.lock() else { return };
        let key = format!("{kind}/{name}");
        if seen.contains(&key) || seen.len() >= 40 {
            return;
        }
        seen.push(key);
    }
    send(app, kind, json!({ "message": name }));
}

/// One search that ended: how many rows came back, and the position of the row
/// the reader opened. `rank` is -1 when they opened nothing.
///
/// The words are not sent and are not written to the log. `rank` alone gives
/// mean reciprocal rank, which says whether the search is getting better, and
/// a run of `hits = 0` says the index is missing something. Neither is a
/// search term, so the promise on the consent screen holds.
pub fn search(app: &AppHandle, hits: u32, rank: i32) {
    send(app, "search", json!({ "count": hits, "rank": rank }));
}

/// An error the front end did not catch. Each message is sent once per launch.
pub fn error(app: &AppHandle, message: &str) {
    let message = clip(message);
    {
        let state = app.state::<Telemetry>();
        let Ok(mut seen) = state.errors.lock() else { return };
        if seen.contains(&message) || seen.len() >= 20 {
            return;
        }
        seen.push(message.clone());
    }
    send(app, "error", json!({ "message": message }));
}

pub fn log_path(app: &AppHandle) -> PathBuf {
    app.state::<Telemetry>().data.join(LOG)
}

fn send(app: &AppHandle, kind: &str, fields: Value) {
    let Some(payload) = payload(app, kind, fields) else { return };
    let data = app.state::<Telemetry>().data.clone();
    append(&data, &payload);
    let Some(endpoint) = endpoint() else { return };
    tauri::async_runtime::spawn(async move {
        let Some(client) = CLIENT.as_ref() else { return };
        if let Err(reason) = client.post(endpoint).json(&payload).send().await {
            eprintln!("telemetry not sent: {reason}");
        }
    });
}

/// One client for every event: each new client loads the system's root
/// certificates again and keeps its own connection pool.
static CLIENT: LazyLock<Option<reqwest::Client>> = LazyLock::new(|| {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder().timeout(Duration::from_secs(5)).build().ok()
});

/// The event, or `None` when the reader has not said yes.
fn payload(app: &AppHandle, kind: &str, fields: Value) -> Option<Value> {
    let db = app.try_state::<crate::Db>()?;
    let db = db.0.lock().ok()?;
    if crate::db::get_setting(&db, KEY).as_deref() != Some("true") {
        return None;
    }
    let id = match crate::db::get_setting(&db, ID_KEY) {
        Some(id) => id,
        None => {
            let id = random_id();
            crate::db::set_setting(&db, ID_KEY, &id).ok()?;
            id
        }
    };
    let mut event = json!({
        "kind": kind,
        "id": id,
        "app": env!("CARGO_PKG_VERSION"),
        "build": crate::db::get_setting(&db, crate::install::BUILD_KEY).unwrap_or_default(),
        "os": os(),
    });
    if let (Some(event), Value::Object(fields)) = (event.as_object_mut(), fields) {
        event.extend(fields);
    }
    Some(event)
}

/// `HOUDINIMD_TELEMETRY_URL` points any build at a local receiver: `wrangler
/// dev`, or the sink `harness/app.mts` runs so a measured launch sends nothing
/// out. Without it, a development build writes the log and sends nothing.
fn endpoint() -> Option<String> {
    std::env::var("HOUDINIMD_TELEMETRY_URL")
        .ok()
        .or_else(|| (!cfg!(debug_assertions)).then(|| ENDPOINT.to_string()))
}

fn append(data: &Path, payload: &Value) {
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(data.join(LOG)) {
        let _ = writeln!(file, "{payload}");
    }
}

/// 128 random bits as hex. `RandomState` is seeded from the operating
/// system's random source, which is all an anonymous id needs.
fn random_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let half = || {
        let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
        hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        hasher.finish()
    };
    format!("{:016x}{:016x}", half(), half())
}

/// Long enough for a stack, short enough for one row at the receiver.
fn clip(text: &str) -> String {
    text.chars().take(4000).collect()
}

#[cfg(windows)]
fn os() -> String {
    let key = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
    let read = |name: &str| key.as_ref().ok().and_then(|k| k.get_value::<String, _>(name).ok()).unwrap_or_default();
    format!("windows {} {}", read("CurrentBuildNumber"), read("DisplayVersion")).trim().to_string()
}

#[cfg(not(windows))]
fn os() -> String {
    std::env::consts::OS.to_string()
}
