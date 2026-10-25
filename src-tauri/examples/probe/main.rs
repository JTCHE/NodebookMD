//! WHAT THE BACK END COSTS, MEASURED, WITH A BUDGET THAT CAN FAIL.
//!
//!   cargo run --release --example probe
//!   cargo run --release --example probe -- --runs 5
//!   cargo run --release --example probe -- --out ../harness/out/probe.json
//!
//! Every number here is a real call into `nodebookmd_lib`, on the Houdini
//! install this machine has, with no app and no window around it. That is the
//! point: the box this runs on has no interactive desktop, and a measurement
//! that needs one is a measurement nobody takes.
//!
//! The front-end half — keystroke to first row, page open and draw — is
//! `harness/ui.mts`. This file answers spec items 1, 4, 5, 8 and 9.
//!
//! A budget is a MEASUREMENT, not a wish. `harness/budgets.json` holds the
//! first honest number for each metric, a little loosened, so a regression
//! fails and a busy laptop does not. When a real change moves a number, move
//! the budget with it and write the reason beside it.
use std::path::{Path, PathBuf};
use std::time::Instant;

mod serve;

use nodebookmd_lib::{all_titles, db, find, help, index, install, read_page};
use rusqlite::Connection;
use serde::Serialize;

/// Words a reader actually types. Short ones matter most: the query runs on
/// every keystroke, so `c` is the shape that hurts, not `copy to points`.
const QUERIES: &[&str] = &[
    "c",
    "co",
    "cop",
    "copy",
    "copy to points",
    "noise",
    "attribute",
    "vex",
    "point cloud",
];

/// How many pages the page-open and memory numbers are taken over. Spread
/// across the whole corpus by path order, never a hand-picked list, so no
/// SideFX page name is written down here. See AGENTS.md.
const PAGES: usize = 50;

/// One measured thing.
#[derive(Serialize)]
struct Metric {
    name: &'static str,
    unit: &'static str,
    /// The median. One cold run must not be able to fail a budget on its own.
    value: f64,
    /// The worst of the runs. Reported for every metric, budgeted for the ones
    /// a reader feels one at a time — a search that is usually fast and
    /// sometimes slow reads as a slow search.
    worst: f64,
    runs: usize,
    note: String,
}

#[derive(Serialize)]
struct Report {
    build: String,
    metrics: Vec<Metric>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let runs = flag(&args, "--runs")
        .and_then(|v| v.parse().ok())
        .unwrap_or(3usize);
    let out = flag(&args, "--out").map(PathBuf::from);
    let work = std::env::temp_dir().join("nodebookmd-probe");

    // `--serve` is the front-end half of the harness, not a measurement of its
    // own: it stands the app up without a window so `harness/ui.mts` can drive
    // the real bundle in a real browser. See serve.rs.
    if let Some(port) = flag(&args, "--serve").and_then(|v| v.parse::<u16>().ok()) {
        let dist = flag(&args, "--dist")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("../dist"));
        // Its OWN database, not the one the measurements above throw away and
        // rebuild: the harness runs the back-end probe again while this server
        // is up, and on Windows a folder cannot be removed out from under an
        // open connection.
        let served = std::env::temp_dir().join("nodebookmd-probe-serve");
        if let Err(reason) = serve::run(port, &served, dist) {
            eprintln!("{reason}");
            std::process::exit(2);
        }
        return;
    }

    // `--build 21.0.829` measures that install; the newest is the default.
    let build = flag(&args, "--build");
    let Some(install) = install::find(&[])
        .into_iter()
        .find(|i| build.as_ref().is_none_or(|b| &i.version == b))
    else {
        eprintln!("no such Houdini install on this machine — nothing to measure");
        std::process::exit(2);
    };
    eprintln!("Houdini {}, {} run(s)", install.version, runs);

    // `--index` times the first index pass alone, with the time of every
    // report it sends.
    if args.iter().any(|a| a == "--index") {
        let runs: Vec<f64> = (0..runs).map(|_| index_once(&work, &install, true)).collect();
        let metric = measured("index.first_pass", "ms", &runs, install.version.clone());
        println!("{}", serde_json::to_string_pretty(&metric).expect("json"));
        return;
    }

    let mut metrics: Vec<Metric> = Vec::new();

    // 1. INDEX TIME. Cold is a fresh database. Warm is a fresh database again,
    //    with the zips already in the operating system's page cache — the
    //    second number is the one a reinstall or a version bump pays.
    let mut cold = Vec::new();
    let mut warm = Vec::new();
    for run in 0..runs {
        let ms = index_once(&work, &install, false);
        if run == 0 {
            cold.push(ms);
        } else {
            warm.push(ms);
        }
    }
    if warm.is_empty() {
        warm.push(cold[0]);
    }
    let pages = {
        let db = db::open(&work).expect("open");
        index::status(&db, &install.version).pages
    };
    metrics.push(measured(
        "index.cold",
        "ms",
        &cold,
        format!("{pages} pages, empty database"),
    ));
    metrics.push(measured(
        "index.warm",
        "ms",
        &warm,
        format!("{pages} pages, page cache warm"),
    ));

    // A build already indexed must cost nothing at all: this is what every
    // later start of the app pays before the first frame.
    let mut skip = Vec::new();
    for _ in 0..runs {
        let mut db = db::open(&work).expect("open");
        let at = Instant::now();
        index::pass(&mut db, &install, &|_| {}, &|| true).expect("pass");
        skip.push(us(at));
    }
    metrics.push(measured(
        "index.skip",
        "µs",
        &skip,
        "a build already done".into(),
    ));

    let db = db::open(&work).expect("open");
    let build = install.version.clone();

    // 2. THE TITLE LIST. Read once at start-up and held in memory, so this is
    //    a start-up cost, not a per-keystroke one.
    let mut list = Vec::new();
    let mut count = 0;
    for _ in 0..runs {
        let at = Instant::now();
        let titles = all_titles(&db, &build).expect("titles");
        list.push(us(at));
        count = titles.len();
    }
    metrics.push(measured(
        "titles.read",
        "µs",
        &list,
        format!("{count} titles"),
    ));

    // 3. SEARCH. Keystroke to rows, for the back-end half of that answer.
    let mut search: Vec<f64> = Vec::new();
    let mut shortest: Vec<f64> = Vec::new();
    for _ in 0..runs {
        for query in QUERIES {
            let at = Instant::now();
            find(&db, &build, query, 18).expect("search");
            let took = us(at);
            search.push(took);
            if query.len() <= 2 {
                shortest.push(took);
            }
        }
    }
    metrics.push(measured(
        "search.query",
        "µs",
        &search,
        format!("{} queries", QUERIES.len()),
    ));
    metrics.push(measured(
        "search.one_letter",
        "µs",
        &shortest,
        "the widest match a reader can type".into(),
    ));

    // 4. PAGE OPEN. Read out of the zip and parsed, which is what the first
    //    page of a fresh install costs — the index never stands in front of it.
    let sample = sample_paths(&db, &build, PAGES);
    let mut open = Vec::new();
    for _ in 0..runs {
        for path in &sample {
            let at = Instant::now();
            let _ = read_page(&install, path);
            open.push(us(at));
        }
    }
    metrics.push(measured(
        "page.open",
        "µs",
        &open,
        format!("{} pages, read and parsed", sample.len()),
    ));

    // 5. IMAGE READ. One entry out of `images.zip`, decompressed. This number
    //    decides whether an image cache is worth building at all.
    let images = image_names(&install.help, 20);
    let mut asset = Vec::new();
    let mut bytes = 0usize;
    for name in &images {
        let at = Instant::now();
        if let Ok(data) = help::asset(&install.help, &format!("images/{name}")) {
            bytes += data.len();
        }
        asset.push(us(at));
    }
    let mean_kb = if images.is_empty() {
        0
    } else {
        bytes / images.len() / 1024
    };
    metrics.push(measured(
        "asset.image",
        "µs",
        &asset,
        format!("{} entries, {mean_kb} KB mean", images.len()),
    ));

    // 6. MEMORY. This process holds what the reader's own queries hold: the
    //    connection, the title list, and the pages just parsed. The webview is
    //    not here, so this is a floor, not the whole app.
    let after = rss_mb();
    metrics.push(measured(
        "memory.after_pages",
        "MB",
        &[after],
        format!("resident after {PAGES} pages"),
    ));

    // 7. DATABASE SIZE. This decides whether two readers on one machine can
    //    each keep an index, or whether one shared read-only index is worth
    //    the complexity.
    let size = db_mb(&work);
    metrics.push(measured(
        "db.size",
        "MB",
        &[size],
        "index.db and its write-ahead log".into(),
    ));

    // THE FLOOR OF THE INSTRUMENT. Everything above is measured with this
    // clock, so no number above means anything below this one. It is printed
    // last because it is the ruler, not a measurement of the product.
    let mut ticks = Vec::new();
    for _ in 0..1000 {
        let at = Instant::now();
        let mut gap = 0.0;
        while gap == 0.0 {
            gap = us(at);
        }
        ticks.push(gap);
    }
    metrics.push(measured(
        "clock.tick",
        "µs",
        &ticks,
        "smallest gap this clock can report".into(),
    ));

    let report = Report { build, metrics };
    let json = serde_json::to_string_pretty(&report).expect("json");
    if let Some(path) = out {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&path, &json).expect("write");
        eprintln!("wrote {}", path.display());
    }
    println!("{json}");
}

/// One full index pass into an empty database, timed, the way the app runs
/// it: `index::run` on a thread of its own. `timeline` prints the time of
/// every report the pass sends, which is what the reader watches the count do.
fn index_once(work: &Path, install: &install::Install, timeline: bool) -> f64 {
    // Loudly. A database that survives this call is a database the pass then
    // returns from in a tenth of a millisecond, and the run reports a full
    // index as free. That happened, and it was silent. Emptied the way
    // `reset_index` empties it; the file stays.
    db::open(work)
        .and_then(|db| engine::db::reset(&db))
        .expect("the probe's own database is in use by something else");
    let (work, install) = (work.to_path_buf(), install.clone());
    let at = Instant::now();
    let reports = std::thread::spawn(move || {
        let seen = std::sync::Mutex::new(Vec::new());
        index::run(&work, &install, &|s| seen.lock().unwrap().push((us(at) / 1000.0, s.pages, s.total)), &|| true)
            .expect("pass");
        seen.into_inner().unwrap()
    })
    .join()
    .expect("the pass panicked");
    let total = us(at) / 1000.0;
    if timeline {
        eprintln!("{total:.0} ms, {} reports", reports.len());
        let mut last = 0.0;
        for (ms, pages, of) in &reports {
            eprintln!("  {ms:>8.0} ms  (+{:>5.0})  {pages:>6} / {of}", ms - last);
            last = *ms;
        }
    }
    total
}

/// Page paths spread evenly across the corpus in path order. Taking the first
/// N would measure one section of the docs and call it the app.
fn sample_paths(db: &Connection, build: &str, want: usize) -> Vec<String> {
    let all: Vec<String> = all_titles(db, build)
        .unwrap_or_default()
        .into_iter()
        .map(|hit| hit.path)
        .collect();
    if all.len() <= want {
        return all;
    }
    let step = all.len() / want;
    all.into_iter().step_by(step).take(want).collect()
}

/// Entry names out of `images.zip`, spread the same way and for the same
/// reason. Read from the archive directory, never written down here.
fn image_names(help: &Path, want: usize) -> Vec<String> {
    let Ok(file) = std::fs::File::open(help.join("images.zip")) else {
        return Vec::new();
    };
    let Ok(archive) = zip::ZipArchive::new(std::io::BufReader::new(file)) else {
        return Vec::new();
    };
    let mut names: Vec<String> = archive
        .file_names()
        .filter(|name| !name.ends_with('/'))
        .map(str::to_string)
        .collect();
    names.sort();
    if names.len() <= want {
        return names;
    }
    let step = names.len() / want;
    names.into_iter().step_by(step).take(want).collect()
}

fn db_mb(work: &Path) -> f64 {
    let (index, _) = db::paths(work);
    let mut bytes = 0u64;
    for name in [
        index.clone(),
        index.with_extension("db-wal"),
        index.with_extension("db-shm"),
    ] {
        bytes += std::fs::metadata(&name).map(|m| m.len()).unwrap_or(0);
    }
    bytes as f64 / 1024.0 / 1024.0
}

#[cfg(windows)]
fn rss_mb() -> f64 {
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let ok = unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    if ok == 0 {
        return 0.0;
    }
    counters.WorkingSetSize as f64 / 1024.0 / 1024.0
}

#[cfg(not(windows))]
fn rss_mb() -> f64 {
    0.0
}

/// Microseconds, from a nanosecond clock.
///
/// Milliseconds are the wrong unit for most of what this file times. A page
/// read in 7ms is 7140µs, and the two digits after the decimal point in the
/// millisecond number are the only part that ever moves. `Instant` on Windows
/// is the high-resolution counter, so the number below is real down to about a
/// tenth of a microsecond — `clock.tick` measures how far down, and every
/// budget is judged against that floor rather than against a round number.
fn us(at: Instant) -> f64 {
    at.elapsed().as_nanos() as f64 / 1000.0
}

fn measured(name: &'static str, unit: &'static str, samples: &[f64], note: String) -> Metric {
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let value = if sorted.is_empty() {
        0.0
    } else if sorted.len() % 2 == 1 {
        sorted[sorted.len() / 2]
    } else {
        (sorted[sorted.len() / 2 - 1] + sorted[sorted.len() / 2]) / 2.0
    };
    let worst = sorted.last().copied().unwrap_or(0.0);
    Metric {
        name,
        unit,
        value: round(value),
        worst: round(worst),
        runs: sorted.len(),
        note,
    }
}

fn round(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}

fn flag(args: &[String], name: &str) -> Option<String> {
    let at = args.iter().position(|a| a == name)?;
    args.get(at + 1).cloned()
}
