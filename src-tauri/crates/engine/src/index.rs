//! Fills `index.db` from the zips of a Houdini install.
//!
//! Two rules from the spec, in order of importance:
//! 1. The page the reader opens is parsed on demand, by `page()`. This pass
//!    never stands between the reader and the first page.
//! 2. Everything else is filled in behind them, as fast as the machine can.
//!    The pass runs once per build and the reader watches it, so it takes
//!    every core for a few seconds rather than a few cores for a minute.
//!
//! See spec: Local — SQLite FTS5 Index.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rayon::prelude::*;
use rusqlite::Connection;
use serde::Serialize;

use crate::db;

/// What the front-end shows while the pass runs, and after it ends.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub build: String,
    /// Pages written so far.
    pub pages: u32,
    /// Pages the install holds, include targets among them.
    pub total: u32,
    pub done: bool,
}

/// Reads the state of one build out of an open connection.
pub fn status(db: &Connection, build: &str) -> Status {
    let (pages, total, done) = db
        .query_row("SELECT pages, total, done FROM builds WHERE build = ?1", [build], |row| {
            Ok((row.get::<_, u32>(0)?, row.get::<_, u32>(1)?, row.get::<_, i64>(2)? == 1))
        })
        .unwrap_or((0, 0, false));
    Status { build: build.to_string(), pages, total, done }
}

/// The whole pass on a connection of its own, for a caller that has none: it
/// opens `index.db` in `data` and fills it. The app owns its connection and
/// calls `pass` instead.
pub fn run(
    data: &Path,
    install: &crate::install::Install,
    report: &dyn Fn(Status),
    live: &(dyn Fn() -> bool + Sync),
) -> Result<(), String> {
    let mut db = db::open(data)?;
    // This connection writes and is then dropped. A 64 MB page cache and no
    // sync took the write from 2.9 s to 2.0 s; a crash mid-pass loses nothing,
    // because an unfinished build is thrown away and read again.
    db.pragma_update(None, "cache_size", -65536).map_err(|e| e.to_string())?;
    db.pragma_update(None, "synchronous", "OFF").map_err(|e| e.to_string())?;
    pass(&mut db, install, report, live)
}

/// Rows per write. Each write is a report, so this is also how often the
/// count climbs while the biggest section goes in.
const CHUNK: usize = 1000;

/// The pass itself, with nowhere to report to but the closure it is given.
/// `live` turning false stops it between two writes: another pass wants the
/// database. A stopped build is left unclaimed, so it reads as never opened.
pub fn pass(
    db: &mut Connection,
    install: &crate::install::Install,
    report: &dyn Fn(Status),
    live: &(dyn Fn() -> bool + Sync),
) -> Result<(), String> {
    let build = install.version.clone();

    if status(db, &build).done {
        report(status(db, &build));
        return Ok(());
    }

    // A half-filled build is thrown away rather than resumed. Resuming would
    // need a per-zip cursor, and a whole pass takes seconds.
    clear(db, &build)?;

    // A package's own help sits at `<package>/help`, shaped exactly like
    // `install.help` — one zip or loose folder per section — so it is indexed
    // by running the same per-section read against each root in turn and
    // pooling the pages found. See `packages.rs`.
    let roots = install.help_roots();
    // The scan below opens every zip's directory, which on a cold disk is the
    // first seconds of the pass. This says the pass has begun before it, so
    // the window never stands at nothing while the machine works.
    report(Status { build: build.clone(), pages: 0, total: 0, done: false });
    let (mut sections, menu) = rayon::join(|| sections(&roots), || crate::place::Menu::read(&roots));
    // The biggest first, so the long parse of Nodes starts at once and ends
    // while the writer is still busy with the small ones.
    sections.sort_by(|a, b| b.1.cmp(&a.1));
    let total: u32 = sections.iter().map(|(_, count)| count).sum();
    // Claim the build now. `clear` removed its row, and until the pass ends
    // there is nothing to tell "indexing" from "nobody has opened this build".
    db.execute("INSERT INTO builds (build, pages, total, done) VALUES (?1, 0, ?2, 0)", rusqlite::params![&build, total])
        .map_err(|e| e.to_string())?;
    let mut pages = 0u32;
    let report = |pages: u32, done: bool| {
        report(Status { build: build.clone(), pages, total, done });
    };
    report(0, false);

    // Each included page is read and parsed once for the whole pass. Read and
    // parsed per include, the same few shared pages cost 20 s of CPU over
    // 13,000 reads, one at a time behind the archive lock.
    let included: Mutex<HashMap<String, Option<Arc<Vec<wiki::Block>>>>> = Mutex::default();
    let load = |path: &str| {
        if let Some(found) = included.lock().ok()?.get(path) {
            return found.clone();
        }
        let found = crate::help::page_layered(&roots, path).ok().map(|source| Arc::new(wiki::parse(&source).blocks));
        included.lock().ok()?.insert(path.to_string(), found.clone());
        found
    };

    // Every core parses; this thread writes each section as it arrives. One
    // SQLite connection writes one row at a time, so the write is the longer
    // half and the parse hides behind it.
    let (send, arrive) = std::sync::mpsc::sync_channel(4);
    std::thread::scope(|scope| -> Result<(), String> {
        scope.spawn(|| {
            sections.par_iter().for_each_with(send, |send, (section, _)| {
                if !live() {
                    return;
                }
                let sources: Vec<(String, String)> =
                    roots.iter().flat_map(|root| read_section(root, section)).collect();
                let map = crate::place::Map::new(&roots, &sources);
                let mut parsed: Vec<Row> =
                    sources.par_iter().filter_map(|page| row(page, &load, &map, &menu)).collect();
                let placed = crate::versions::place(parsed.iter_mut().filter_map(|row| row.mark.take()).collect());
                crate::place::arrange(&mut parsed, |row| &row.title, |row| &mut row.place);
                let _ = send.send((parsed, placed));
            });
        });
        for (parsed, placed) in arrive {
            for rows in parsed.chunks(CHUNK) {
                if !live() {
                    return Ok(());
                }
                pages += write(db, &build, rows, &placed, pages)? as u32;
                report(pages, false);
            }
        }
        Ok(())
    })?;
    if !live() {
        db.execute("DELETE FROM builds WHERE build = ?1", [&build]).map_err(|e| e.to_string())?;
        return Ok(());
    }

    db.execute("UPDATE builds SET pages = ?2, done = 1 WHERE build = ?1", rusqlite::params![&build, pages])
        .map_err(|e| e.to_string())?;
    report(pages, true);
    Ok(())
}

/// One page, ready to write.
struct Row {
    path: String,
    title: String,
    node_type: Option<String>,
    icon: Option<String>,
    summary: Option<String>,
    /// The body, cut at its headings. See `sections.rs`.
    sections: Vec<crate::sections::Section>,
    /// Taken before the write, once the whole section is read and the other
    /// versions of the node are known.
    mark: Option<crate::versions::Mark>,
    /// Where the sidebar draws it. See `place.rs`.
    place: crate::place::Place,
}

fn row(
    (path, source): &(String, String),
    load: &wiki::include::Load,
    map: &crate::place::Map,
    menu: &crate::place::Menu,
) -> Option<Row> {
    let mut parsed = wiki::parse(source);
    if is_include_target(path, &parsed.props) {
        return None;
    }
    wiki::include::resolve(&mut parsed.blocks, path, load);
    let markdown = wiki::markdown::blocks(&parsed.blocks, 1);
    Some(Row {
        path: path.clone(),
        title: crate::page::name(path, &parsed),
        node_type: crate::page::node_type(&parsed.props),
        icon: wiki::model::prop(&parsed.props, "icon").map(crate::help::icon_file),
        summary: crate::page::summary(&parsed),
        sections: crate::sections::split(&markdown),
        mark: crate::versions::mark(path, &parsed.props),
        place: map.place(path, &parsed.props, menu),
    })
}

/// A page written to be included by other pages, not to be read on its own.
///
/// SideFX marks most of them `#type: include`; the rest are named with a
/// leading underscore, such as `nodes/vop/_materialx`, whose `@`-sections are
/// the names other pages include and read as invented headings on their own.
/// Both stay readable by path — only the title list and search leave them out.
/// See spec: Local — Include targets become headings.
fn is_include_target(path: &str, props: &wiki::Props) -> bool {
    if wiki::model::prop(props, "type") == Some("include") {
        return true;
    }
    // `apex/__null__` is a real node whose name starts that way.
    let name = path.rsplit('/').next().unwrap_or_default();
    name.starts_with('_') && !name.starts_with("__")
}

fn write(
    db: &mut Connection,
    build: &str,
    rows: &[Row],
    placed: &HashMap<String, crate::versions::Place>,
    first_seq: u32,
) -> Result<usize, String> {
    let tx = db.transaction().map_err(|e| e.to_string())?;
    {
        let mut page = tx
            .prepare(
                "INSERT OR REPLACE INTO pages (build, path, title, node_type, icon, summary, family, label, rank, place, seq)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            )
            .map_err(|e| e.to_string())?;
        let mut text = tx
            .prepare(
                "INSERT INTO pages_fts (build, path, slug, heading, title, body)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| e.to_string())?;
        for (seq, row) in (first_seq..).zip(rows) {
            let folders: Vec<&str> = row.place.folders.iter().map(|f| f.label.as_str()).collect();
            let place = placed.get(&row.path);
            page.execute(rusqlite::params![
                build,
                &row.path,
                &row.title,
                &row.node_type,
                &row.icon,
                &row.summary,
                place.map(|p| &p.family),
                place.map(|p| &p.label),
                place.map_or(0, |p| p.rank),
                folders.join("\n"),
                seq
            ])
            .map_err(|e| e.to_string())?;
            // An older version stays out of the search, so a search for one
            // node spends one result on it and never opens the wrong version.
            if place.is_some_and(|p| p.rank > 0) {
                continue;
            }
            // The title rides the FIRST section only. On every section it would
            // count once per heading, and a long page would outrank the page
            // actually named for the words.
            let mut named = false;
            for section in &row.sections {
                let title = if named { "" } else { row.title.as_str() };
                named = true;
                text.execute(rusqlite::params![
                    build,
                    &row.path,
                    &section.slug,
                    &section.heading,
                    title,
                    &section.body
                ])
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.execute("UPDATE builds SET pages = ?2 WHERE build = ?1", rusqlite::params![build, first_seq + rows.len() as u32])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(rows.len())
}

fn clear(db: &Connection, build: &str) -> Result<(), String> {
    for statement in [
        "DELETE FROM pages WHERE build = ?1",
        "DELETE FROM pages_fts WHERE build = ?1",
        "DELETE FROM builds WHERE build = ?1",
    ] {
        db.execute(statement, [build]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The sections across every help root and how many pages each one holds in
/// total. A root a package contributes rarely adds a whole new section — Labs
/// only ever adds to `nodes` — but nothing here assumes that.
///
/// A section is `nodes.zip` or a plain folder such as `examples`. About 1,220
/// pages ship loose beside the zips; reading only archives left every one of
/// them out. `images.zip`, `videos` and `movies` are assets, not pages — see
/// spec: Local — Image and Asset Serving.
pub(crate) fn sections(roots: &[PathBuf]) -> Vec<(String, u32)> {
    let mut sections: Vec<String> = roots.iter().flat_map(|help| section_names(help)).collect();
    sections.sort();
    sections.dedup();
    sections
        .into_par_iter()
        .map(|section| {
            let pages = roots.iter().map(|help| count(help, &section)).sum();
            (section, pages)
        })
        .collect()
}

fn section_names(help: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(help) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_stem()?.to_str()?.to_string();
            let zip = path.extension().is_some_and(|e| e == "zip");
            if !zip && !path.is_dir() {
                return None;
            }
            (name != "images" && name != "videos" && name != "movies").then_some(name)
        })
        .collect()
}

/// Counts the pages of a section. A zip is counted from its directory alone,
/// without reading a byte of any entry.
fn count(help: &Path, section: &str) -> u32 {
    let zip = open_zip(&help.join(format!("{section}.zip")))
        .map(|archive| archive.file_names().filter(|name| name.ends_with(".txt")).count() as u32)
        .unwrap_or(0);
    zip + loose(&help.join(section)).len() as u32
}

/// `sop/box.txt` in `nodes.zip` is the page `nodes/sop/box`, which is the path
/// `help::page` takes back. A loose folder answers to the same paths.
pub(crate) fn read_section(help: &Path, section: &str) -> Vec<(String, String)> {
    let mut pages = Vec::new();
    each_page(help, section, |path, source| pages.push((path.to_string(), source.to_string())));
    pages
}

/// The pages of `read_section`, one at a time through one buffer, for a caller
/// that keeps a little of each page and not the page.
pub(crate) fn each_page(help: &Path, section: &str, mut visit: impl FnMut(&str, &str)) {
    let mut source = String::new();
    if let Ok(mut archive) = open_zip(&help.join(format!("{section}.zip"))) {
        let names: Vec<String> = archive
            .file_names()
            .filter(|name| name.ends_with(".txt"))
            .map(str::to_string)
            .collect();
        for name in names {
            let Ok(mut entry) = archive.by_name(&name) else {
                continue;
            };
            source.clear();
            if entry.read_to_string(&mut source).is_err() {
                continue;
            }
            visit(&format!("{section}/{}", name.trim_end_matches(".txt")), &source);
        }
    }
    let folder = help.join(section);
    for file in loose(&folder) {
        let Ok(name) = file.strip_prefix(&folder) else {
            continue;
        };
        let Some(name) = name.to_str() else {
            continue;
        };
        let Ok(source) = std::fs::read_to_string(&file) else {
            continue;
        };
        let name = name.replace('\\', "/");
        visit(&format!("{section}/{}", name.trim_end_matches(".txt")), &source);
    }
}

/// Every `.txt` under a loose section folder, at any depth.
fn loose(folder: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            found.extend(loose(&path));
        } else if path.extension().is_some_and(|e| e == "txt") {
            found.push(path);
        }
    }
    found
}

fn open_zip(zip: &Path) -> Result<zip::ZipArchive<std::io::BufReader<std::fs::File>>, String> {
    let file = std::fs::File::open(zip).map_err(|e| e.to_string())?;
    zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| e.to_string())
}

/// Background mode drops the disk priority of the thread as well as its CPU
/// priority. The localhost server runs in it. The index pass does not: in
/// background mode its write took four times as long.
#[cfg(windows)]
pub fn background_priority() {
    use windows_sys::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_MODE_BACKGROUND_BEGIN,
    };
    unsafe { SetThreadPriority(GetCurrentThread(), THREAD_MODE_BACKGROUND_BEGIN as i32) };
}

#[cfg(not(windows))]
pub fn background_priority() {}

