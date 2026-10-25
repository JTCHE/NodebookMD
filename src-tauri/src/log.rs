//! The diagnostic log: what the app did, in order, with times.
//!
//! This is not telemetry. Nothing here leaves the machine, it is written
//! whether or not the reader said yes to usage data, and it holds the local
//! facts telemetry may never hold: paths, versions, ports, and the reason a
//! thing failed. It is for one question — "send me your log" — so it keeps
//! the launch, the install it reads, the index pass, the server, the F1 hook,
//! the update check, and every error, and it keeps nothing per page read.
//!
//! The files sit in `logs/` beside `index.db`, so they go when the data folder
//! goes: an uninstall that removes the app data removes them, and a portable
//! copy carries them in its own folder.

use std::fmt::Arguments;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

/// One file may reach this before the next one starts. Three files of this
/// size is the whole cost of logging on the reader's disk.
const LIMIT: u64 = 512 * 1024;
/// Older files kept beside the open one: `nodebookmd.1.log`, `nodebookmd.2.log`.
const KEEP: u32 = 2;
const NAME: &str = "nodebookmd";

struct Sink {
    file: File,
    dir: PathBuf,
    written: u64,
}

static SINK: Mutex<Option<Sink>> = Mutex::new(None);

/// Opens `logs/nodebookmd.log` and writes the first line. Called once, before
/// anything else in `setup`, so the log holds the whole launch.
pub fn start(data: &Path, version: &str) {
    let dir = data.join("logs");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    rotate(&dir);
    let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("{NAME}.log"))) else {
        return;
    };
    let written = file.metadata().map(|m| m.len()).unwrap_or(0);
    if let Ok(mut sink) = SINK.lock() {
        *sink = Some(Sink { file, dir, written });
    }
    line(Level::Info, "app", format_args!("{} {version} starting, data {}", crate::APP_NAME, data.display()));
    line(Level::Info, "app", format_args!("times are UTC"));
}

/// Where the reader finds the log. Empty before `start`.
pub fn dir() -> Option<PathBuf> {
    SINK.lock().ok()?.as_ref().map(|sink| sink.dir.clone())
}

#[derive(Clone, Copy)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn word(self) -> &'static str {
        match self {
            Level::Info => "INFO ",
            Level::Warn => "WARN ",
            Level::Error => "ERROR",
        }
    }
}

/// One line. `area` is a fixed word this code writes — `index`, `server`,
/// `hook` — so a log reads as a column and can be grepped.
pub fn line(level: Level, area: &str, message: Arguments) {
    let text = format!("{} {} {area}: {message}", stamp(), level.word());
    if cfg!(debug_assertions) {
        eprintln!("{text}");
    }
    let Ok(mut held) = SINK.lock() else { return };
    let Some(sink) = held.as_mut() else { return };
    if writeln!(sink.file, "{text}").is_ok() {
        sink.written += text.len() as u64 + 2;
    }
    if sink.written < LIMIT {
        return;
    }
    // Full: close this file, move it aside, and open an empty one.
    let dir = sink.dir.clone();
    *held = None;
    rotate(&dir);
    if let Ok(file) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(format!("{NAME}.log"))) {
        *held = Some(Sink { file, dir, written: 0 });
    }
}

/// `nodebookmd.1.log` becomes `.2.log`, the open file becomes `.1.log`, and the
/// oldest is written over. No file is ever left for the reader to find later.
fn rotate(dir: &Path) {
    let at = |n: u32| dir.join(format!("{NAME}.{n}.log"));
    let live = dir.join(format!("{NAME}.log"));
    if std::fs::metadata(&live).is_ok_and(|m| m.len() < LIMIT) {
        return;
    }
    for n in (1..KEEP).rev() {
        let _ = std::fs::rename(at(n), at(n + 1));
    }
    let _ = std::fs::rename(&live, at(1));
}

/// `2026-09-16 09:39:13.123`, UTC. A local time would need the zone rules,
/// and a log a reader mails to me is easier to read in one zone anyway.
fn stamp() -> String {
    let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default();
    let secs = now.as_secs();
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let (year, month, day) = civil(days as i64);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}.{:03}",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60,
        now.subsec_millis()
    )
}

/// Days since 1970-01-01 to a calendar date. Howard Hinnant's `civil_from_days`,
/// which is the whole of a date library this log needs.
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[macro_export]
macro_rules! say {
    ($level:ident, $area:expr, $($arg:tt)*) => {
        $crate::log::line($crate::log::Level::$level, $area, format_args!($($arg)*))
    };
}
