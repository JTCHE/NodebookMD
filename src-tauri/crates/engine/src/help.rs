//! Reads help pages and icons out of the zips in a Houdini install.
//! Nothing is extracted to disk. See spec: Local — Image and Asset Serving.

use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

type Archive = zip::ZipArchive<BufReader<File>>;

/// The archives this process has opened, kept open, the most recent last.
///
/// `icons.zip` holds about ten thousand entries. Opening it means reading and
/// parsing that whole central directory, and the sidebar asks for a dozen
/// icons in the time it takes to draw one list — so the first row of a list
/// used to cost as much as all the rest of it together. The archive is parsed
/// once and every later read seeks inside it.
///
/// A parsed directory is memory for as long as it is kept: the icons, the
/// images and the nodes each hold megabytes. `KEEP` covers those and the
/// section being read; one more section drops the one read longest ago.
static ARCHIVES: LazyLock<Mutex<Vec<(PathBuf, Archive)>>> = LazyLock::new(|| Mutex::new(Vec::new()));
const KEEP: usize = 4;

/// Runs `use_it` on the archive at `zip`, opened once and kept.
fn with_archive<T>(zip: &Path, use_it: impl FnOnce(&mut Archive) -> T) -> Result<T, String> {
    let mut open = ARCHIVES.lock().map_err(|e| e.to_string())?;
    let archive = match open.iter().position(|(path, _)| path == zip) {
        Some(at) => open.remove(at).1,
        None => {
            let file = File::open(zip).map_err(|e| format!("{}: {e}", zip.display()))?;
            let archive = zip::ZipArchive::new(BufReader::new(file)).map_err(|e| e.to_string())?;
            if open.len() == KEEP {
                open.remove(0);
            }
            archive
        }
    };
    open.push((zip.to_path_buf(), archive));
    Ok(use_it(&mut open.last_mut().expect("just pushed").1))
}

/// Why a page could not be read. `Missing` is the reader's problem — this build
/// holds no such page — and the front-end draws the not-found page for it.
#[derive(Debug)]
pub enum PageError {
    Missing,
    Unreadable(String),
}

/// `nodes/sop/box` lives in `nodes.zip` as `sop/box.txt`. A path that names a
/// directory, such as `vex/contexts`, reads that directory's `index.txt` — the
/// help links to both forms.
///
/// Not every section is a zip. `examples`, `licenses`, `heightfields` and six
/// more ship as plain folders beside the zips, about 1,220 pages the reader
/// could not reach at all while this only opened archives.
/// See spec: Local — Pages missing from the app index.
pub fn page(help: &Path, path: &str) -> Result<String, PageError> {
    page_at(help, path)?.ok_or(PageError::Missing)
}

/// The same read as `page`, tried against `roots` in order — a build's own
/// help first, then each package's. The first root that holds the page wins;
/// a root that cannot be read at all is skipped rather than failing the whole
/// lookup, so one broken package zip does not hide every other root's pages.
pub fn page_layered(roots: &[PathBuf], path: &str) -> Result<String, PageError> {
    let mut last = None;
    for root in roots {
        match page_at(root, path) {
            Ok(Some(source)) => return Ok(source),
            Ok(None) => {}
            Err(reason) => last = Some(reason),
        }
    }
    match last {
        Some(reason) => Err(reason),
        None => Err(PageError::Missing),
    }
}

/// Whether any root holds the page, read the same way as `page_layered` but
/// without the read: a link can ask this for every page it might mean.
pub fn exists_layered(roots: &[PathBuf], path: &str) -> bool {
    let path = path.trim_matches('/');
    let (section, rest) = path.split_once('/').unwrap_or((path, "index"));
    if path.is_empty() || rest.contains("..") {
        return false;
    }
    let names = [format!("{rest}.txt"), format!("{rest}/index.txt")];
    roots.iter().any(|help| {
        let zip = help.join(format!("{section}.zip"));
        let folder = help.join(section);
        names.iter().any(|name| holds(&zip, name) || folder.join(name).is_file())
    })
}

fn holds(zip: &Path, name: &str) -> bool {
    with_archive(zip, |archive| archive.index_for_name(name).is_some()).unwrap_or(false)
}

/// `Ok(None)` means this one root holds no such page.
fn page_at(help: &Path, path: &str) -> Result<Option<String>, PageError> {
    let path = path.trim_matches('/');
    if path.is_empty() {
        return Ok(None);
    }
    // `network/` names the section's own index page, and the help writes that
    // form as often as it writes `network/index`.
    let (section, rest) = path.split_once('/').unwrap_or((path, "index"));
    if rest.contains("..") {
        return Ok(None);
    }
    let names = [format!("{rest}.txt"), format!("{rest}/index.txt")];

    let zip = help.join(format!("{section}.zip"));
    let mut found = None;
    if zip.is_file() {
        for name in &names {
            found = read(&zip, name).map_err(PageError::Unreadable)?;
            if found.is_some() {
                break;
            }
        }
    }
    let folder = help.join(section);
    if found.is_none() && folder.is_dir() {
        found = names.iter().find_map(|name| std::fs::read(folder.join(name)).ok());
    }
    match found {
        Some(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|e| PageError::Unreadable(e.to_string())),
        None => Ok(None),
    }
}

/// `SOP/box.svg` lives in `config/Icons/icons.zip` under the same name.
pub fn icon(install_root: &Path, name: &str) -> Result<Vec<u8>, String> {
    let zip = install_root
        .join("houdini")
        .join("config")
        .join("Icons")
        .join("icons.zip");
    found(read(&zip, name.trim_matches('/')), &format!("no icon {name}"))
}

/// The path in `icons.zip` of the icon a page's `#icon:` names. Most pages
/// write `SOP/box`; some write `SOP/quadremesh.svg`.
pub fn icon_file(name: &str) -> String {
    let name = name.trim().trim_start_matches('/');
    let name = name.strip_prefix("icons/").unwrap_or(name);
    if name.ends_with(".svg") {
        name.to_string()
    } else {
        format!("{name}.svg")
    }
}

/// The same read as `icon`, then a package's own icons — loose files, not a
/// zip; a package ships too few to be worth archiving. `help/icons/` is where
/// a package's node-doc icons actually live (SideFX Labs ships 167 there);
/// `config/Icons/` is checked too, since that is where `icon()` itself reads
/// core icons from and a package can use it the same way.
pub fn icon_layered(install_root: &Path, packages: &[PathBuf], name: &str) -> Result<Vec<u8>, String> {
    if let Ok(bytes) = icon(install_root, name) {
        return Ok(bytes);
    }
    let clean = name.trim_matches('/');
    if clean.contains("..") {
        return Err(format!("no icon {name}"));
    }
    for package in packages {
        for folder in [package.join("help").join("icons"), package.join("config").join("Icons")] {
            if let Ok(bytes) = std::fs::read(folder.join(clean)) {
                return Ok(bytes);
            }
        }
    }
    Err(format!("no icon {name}"))
}

/// Reads one asset, named the way `assets::resolve` writes it.
///
/// `images/shelf/copy.jpg` is an entry in `images.zip`. `videos/tween.webm` is
/// a loose file: the install ships 958 of them beside the zips, not inside one.
/// `movies/rotate.gif` is the same shape as `videos`, under the name a
/// package's own help uses for it. A package keeps its pictures loose too, in
/// `help/images/`, with no `images.zip`.
pub fn asset(help: &Path, path: &str) -> Result<Vec<u8>, String> {
    let absent = format!("no asset {path}");
    let Some((store, name)) = path.trim_matches('/').split_once('/') else {
        return Err(absent);
    };
    match store {
        "images" => found(read(&help.join("images.zip"), name), &absent)
            .or_else(|absent| loose(help, "images", name).ok_or(absent)),
        "videos" => loose(help, "videos", name).ok_or(absent),
        "movies" => loose(help, "movies", name).ok_or(absent),
        _ => Err(absent),
    }
}

/// The same read as `asset`, tried against each help root in turn.
pub fn asset_layered(roots: &[PathBuf], path: &str) -> Result<Vec<u8>, String> {
    let mut last = format!("no asset {path}");
    for root in roots {
        match asset(root, path) {
            Ok(bytes) => return Ok(bytes),
            Err(reason) => last = reason,
        }
    }
    Err(last)
}

/// The size of a picture named the way `assets::resolve` writes it, read
/// from the head of its file alone. `None` for a video, or a picture no root
/// holds.
pub fn picture_size(roots: &[PathBuf], path: &str) -> Option<wiki::Size> {
    let name = path.strip_prefix("images/")?;
    if name.contains("..") {
        return None;
    }
    roots.iter().find_map(|root| {
        let zipped = with_archive(&root.join("images.zip"), |archive| {
            let entry = archive.by_name(name).ok()?;
            let mut head = Vec::new();
            entry.take(crate::picture::HEAD).read_to_end(&mut head).ok()?;
            Some(head)
        });
        let head = match zipped {
            Ok(Some(head)) => head,
            _ => {
                let mut head = Vec::new();
                File::open(root.join("images").join(name))
                    .ok()?
                    .take(crate::picture::HEAD)
                    .read_to_end(&mut head)
                    .ok()?;
                head
            }
        };
        crate::picture::size(&head)
    })
}

/// A video or movie is read whole. The `himage` handler serves the range the
/// player asked for out of these bytes; the largest file in the install is
/// 6.3 MB.
fn loose(help: &Path, folder: &str, name: &str) -> Option<Vec<u8>> {
    if name.contains("..") {
        return None;
    }
    std::fs::read(help.join(folder).join(name)).ok()
}

fn found(read: Result<Option<Vec<u8>>, String>, absent: &str) -> Result<Vec<u8>, String> {
    read.map_err(|_| absent.to_string())?
        .ok_or_else(|| absent.to_string())
}

/// Every entry name in a zip that starts with `prefix` and ends `.txt`. Used
/// to list a whole family of pages, such as every VEX function, rather than
/// read one page by its own path.
pub fn entries(zip: &Path, prefix: &str) -> Vec<String> {
    with_archive(zip, |archive| {
        archive
            .file_names()
            .filter(|name| name.starts_with(prefix) && name.ends_with(".txt"))
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

/// The text of one entry, read the same way `page` reads a `.txt`.
pub fn text(zip: &Path, name: &str) -> Option<String> {
    let bytes = read(zip, name).ok().flatten()?;
    String::from_utf8(bytes).ok()
}

/// `Ok(None)` means the archive holds no such entry. `Err` means the archive
/// itself could not be read.
fn read(zip: &Path, name: &str) -> Result<Option<Vec<u8>>, String> {
    if name.contains("..") {
        return Err("a path cannot leave its archive".into());
    }
    with_archive(zip, |archive| {
        let Ok(mut entry) = archive.by_name(name) else {
            return Ok(None);
        };
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        Ok(Some(bytes))
    })?
}
