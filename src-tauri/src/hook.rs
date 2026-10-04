//! Points Houdini's F1 at this app, and takes the pointer back.
//!
//! Houdini reads the external help server from two preferences. There is no
//! environment variable for either, and a Houdini package cannot set a
//! preference, so `houdini.pref` is the only way in. That file belongs to the
//! reader, so every write here is recorded and reversible.
//! See spec: Local — Localhost Server and Houdini Hook.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The keys Houdini reads. Verified on 22.0.368 against `libFUSE.dll` and
/// `help.zip/central.txt`.
const USE_EXTERNAL: &str = "misc.useexternalhelp.val";
const EXTERNAL_URL: &str = "misc.externalhelpurl.val";

/// What this app wrote, so it can put back exactly what was there.
const RECORD: &str = "houdini-hook.json";

/// One Houdini release series, which is what a preferences directory covers.
/// `22.0.368` and `22.0.401` share `houdini22.0`, so the hook is per series and
/// never per build.
#[derive(Debug, Clone, Serialize)]
pub struct Release {
    /// `22.0`, taken from the directory name.
    pub release: String,
    pub prefs: PathBuf,
    /// The help URL this release points at now, if it points anywhere.
    pub url: Option<String>,
    /// Whether this release uses an external help server at all.
    pub external: bool,
    /// Whether the URL is this app's server on `port`.
    pub ours: bool,
}

/// What one release looked like before the hook touched it. A key that was
/// absent is `None`, and reverting removes it again rather than writing a
/// default the reader never chose.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Previous {
    prefs: PathBuf,
    use_external: Option<String>,
    url: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Record {
    port: u16,
    releases: BTreeMap<String, Previous>,
}

/// Every release series that is installed and has a preferences directory,
/// newest first. `installed` is the builds the version picker lists, so the
/// two never disagree: preferences left behind by an uninstalled Houdini do
/// not count. A directory with no `houdini.pref` still counts: Houdini writes
/// that file on exit, and the hook can create it.
pub fn releases(port: u16, installed: &[String]) -> Vec<Release> {
    let mut found: Vec<Release> = Vec::new();
    let Some(parent) = prefs_root() else {
        return found;
    };
    let Ok(entries) = std::fs::read_dir(&parent) else {
        return found;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(release) = series(&path).filter(|release| installed.iter().any(|build| series_of(build) == *release)) else {
            continue;
        };
        let text = read(&path.join("houdini.pref")).unwrap_or_default();
        // The pref file quotes the value; the reader is shown the address.
        let url = value(&text, EXTERNAL_URL).map(|url| url.trim_matches('"').to_string());
        let external = value(&text, USE_EXTERNAL).as_deref() == Some("1");
        found.push(Release {
            ours: url.as_deref().is_some_and(|url| is_ours(url, port)),
            release,
            prefs: path,
            url,
            external,
        });
    }
    found.sort_by(|a, b| parts(&b.release).cmp(&parts(&a.release)));
    found
}

/// The release series a build belongs to: `22.0.368` is `22.0`. A preferences
/// directory covers a series, so this is what turns a chosen install into the
/// release the hook can act on.
pub fn series_of(build: &str) -> String {
    build.split('.').take(2).collect::<Vec<_>>().join(".")
}

/// Turns F1 towards this app for the named releases, and records what it
/// replaced. Applying twice writes the same file, so the installer can run it
/// on every launch without asking whether it ran before.
pub fn apply(data: &Path, port: u16, wanted: &[String]) -> Result<Vec<String>, String> {
    let mut record = load(data);
    record.port = port;
    // The trailing slash is not decoration. Houdini joins the help path onto
    // this string, and without it the pane only ever asks for the base URL.
    let url = format!("http://localhost:{port}/");
    let mut changed = Vec::new();

    // `wanted` names release series, and a series is its own series.
    let found = releases(port, wanted);
    // A series with no preferences folder is skipped by `releases`. Without
    // this, onboarding said nothing and F1 stayed with Houdini.
    if let Some(missing) = wanted.iter().find(|want| !found.iter().any(|release| &release.release == *want)) {
        return Err(format!(
            "Houdini {missing} has no preferences folder yet. Start it once, close it, then turn on F1 in Settings."
        ));
    }
    for release in found {
        if running(&release.release) {
            return Err(format!(
                "Houdini {} is open. It writes houdini.pref when it exits, which would undo this. Close it first.",
                release.release
            ));
        }
        let file = release.prefs.join("houdini.pref");
        let before = read(&file).unwrap_or_default();

        // Record the first state this app ever saw, never a later one, or a
        // second apply would record its own writing as the reader's choice.
        record.releases.entry(release.release.clone()).or_insert_with(|| Previous {
            prefs: release.prefs.clone(),
            use_external: value(&before, USE_EXTERNAL),
            url: value(&before, EXTERNAL_URL),
        });

        let after = set(&set(&before, USE_EXTERNAL, "1"), EXTERNAL_URL, &quoted(&url));
        if after != before {
            backup(&file)?;
            write(&file, &after)?;
            changed.push(release.release.clone());
        }
        start_with_houdini(data, &release.prefs)?;
    }

    save(data, &record)?;
    crate::say!(Info, "hook", "F1 now opens this app in Houdini {}", changed.join(", "));
    Ok(changed)
}

/// Puts back what was there before the first apply, then forgets the release.
/// A key the reader never had is removed, not set to a default. An empty
/// `wanted` means every release this app hooked.
pub fn revert(data: &Path, wanted: &[String]) -> Result<Vec<String>, String> {
    let mut record = load(data);
    let mut restored = Vec::new();
    let chosen: Vec<String> = record
        .releases
        .keys()
        .filter(|release| wanted.is_empty() || wanted.contains(release))
        .cloned()
        .collect();
    if let Some(release) = chosen.iter().find(|release| running(release)) {
        return Err(format!(
            "Houdini {release} is open. Close it first, or it will write the old value back."
        ));
    }

    for release in chosen {
        let Some(previous) = record.releases.remove(&release) else {
            continue;
        };
        // Our own file, so there is nothing of the reader's to put back.
        let _ = std::fs::remove_file(previous.prefs.join("packages").join(PACKAGE));
        let file = previous.prefs.join("houdini.pref");
        let before = read(&file).unwrap_or_default();
        let after = apply_previous(&before, &previous);
        if after != before {
            write(&file, &after)?;
            restored.push(release);
        }
    }

    save(data, &record)?;
    crate::say!(Info, "hook", "F1 given back to Houdini {}", restored.join(", "));
    Ok(restored)
}

/// The Houdini package that starts this app when Houdini starts. F1 points at
/// a localhost port, and a closed app answers it with "connection refused".
/// Houdini starts its own help server the same way: on demand, from Houdini.
const PACKAGE: &str = "houdinimd.json";

/// `uiready.py` is found under `pythonX.Ylibs`, named for the Python the
/// session runs, and it runs in interactive sessions only — never in hython.
// ponytail: fixed list; a Houdini on a newer Python needs its version added.
const PYTHONS: [&str; 5] = ["3.10", "3.11", "3.12", "3.13", "3.14"];

/// Writes the package into one release's preferences. Its `hpath` names a
/// folder in this app's data, so the script itself never sits among the
/// reader's files, and removing the one package file undoes it all.
fn start_with_houdini(data: &Path, prefs: &Path) -> Result<(), String> {
    let root = data.join("houdini");
    write_startup_script(&root)?;
    let package = serde_json::json!({ "hpath": root.to_string_lossy().replace('\\', "/") });
    let text = serde_json::to_string_pretty(&package).map_err(|e| e.to_string())?;
    write(&prefs.join("packages").join(PACKAGE), &text)
}

/// The script names this exe. A debug build draws its window from the Vite
/// dev server. Named here, it would start with Houdini after the dev server is
/// gone and show "localhost refused to connect", so it leaves the script to
/// the installed app.
fn write_startup_script(root: &Path) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    // An AppImage runs from a mount that goes when it exits; `APPIMAGE` names
    // the file itself.
    let exe = match std::env::var_os("APPIMAGE") {
        Some(file) => std::path::PathBuf::from(file),
        None => std::env::current_exe().map_err(|e| e.to_string())?,
    };
    // macOS runs an app opened straight from Downloads or from its disk image
    // out of a random path that is gone when it quits.
    if exe.to_string_lossy().contains("/AppTranslocation/") {
        return Err(format!("Move {} to Applications, open it from there, then try again.", crate::APP_NAME));
    }
    let record = root.parent().map(|data| data.join(RECORD)).unwrap_or_default();
    let script = startup_script(&exe, &record);
    for python in PYTHONS {
        write(&root.join(format!("python{python}libs")).join("uiready.py"), &script)?;
    }
    Ok(())
}

/// Names this exe in the startup script again, on each launch. The install
/// folder follows the app's name, so a rename moves the exe, and a script that
/// names the old one starts nothing when Houdini starts.
pub fn refresh(data: &Path) {
    if load(data).releases.is_empty() {
        return;
    }
    if let Err(reason) = write_startup_script(&data.join("houdini")) {
        crate::say!(Warn, "hook", "startup script not written: {reason}");
    }
}

/// A second launch hands over to the running app and exits, so this script
/// does not need to know whether the app is already up.
///
/// An app that was deleted, not uninstalled, leaves F1 pointing at a port that
/// nothing answers. macOS and an AppImage have no uninstaller, so the script
/// gives F1 back itself: it puts back what `record` says was there, and
/// removes the package that loads it.
fn startup_script(exe: &Path, record: &Path) -> String {
    // Rust's debug form of a string is a valid Python string literal.
    let exe = format!("{:?}", exe.to_string_lossy());
    let record = format!("{:?}", record.to_string_lossy());
    format!(
        "# Written by {name}. Starts its help server with Houdini, so F1 has an
# answer. {name} removes the package that loads this when F1 is given back.
import os, subprocess, sys
exe = {exe}
if os.path.exists(exe):
    # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP on Windows, a new session
    # elsewhere: the app outlives this Houdini.
    windows = sys.platform == \"win32\"
    try:
        subprocess.Popen([exe, \"--background\"], close_fds=True,
                         creationflags=0x00000008 | 0x00000200 if windows else 0,
                         start_new_session=not windows)
    except OSError:
        pass
else:
    import json, hou
    try:
        with open({record}) as file:
            series = \"%d.%d\" % hou.applicationVersion()[:2]
            before = json.load(file)[\"releases\"][series]
    except (OSError, ValueError, KeyError):
        before = {{}}
    hou.setPreference(\"{use}\", (before.get(\"use_external\") or \"0\").strip('\"'))
    hou.setPreference(\"{url}\", (before.get(\"url\") or \"\").strip('\"'))
    try:
        os.remove(os.path.join(hou.homeHoudiniDirectory(), \"packages\", \"{package}\"))
    except OSError:
        pass
",
        name = crate::APP_NAME,
        use = USE_EXTERNAL,
        url = EXTERNAL_URL,
        package = PACKAGE,
    )
}

fn apply_previous(text: &str, previous: &Previous) -> String {
    let text = match &previous.use_external {
        Some(value) => set(text, USE_EXTERNAL, value),
        None => remove(text, USE_EXTERNAL),
    };
    match &previous.url {
        Some(value) => set(&text, EXTERNAL_URL, value),
        None => remove(&text, EXTERNAL_URL),
    }
}

/// A URL this app serves. The port can move, so the host decides, not the
/// whole string — a reader who kept an older port still counts as hooked.
fn is_ours(url: &str, port: u16) -> bool {
    let url = url.trim_matches('"');
    url.starts_with(&format!("http://localhost:{port}"))
        || url.starts_with(&format!("http://127.0.0.1:{port}"))
}

/// Reads `key := value;` out of a preferences file. Quotes stay on, because
/// that is how the value must go back.
fn value(text: &str, key: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.trim().strip_prefix(key)?.trim().strip_prefix(":=").map(str::trim))
        .map(|value| value.trim_end_matches(';').trim().to_string())
}

/// Writes one key, keeping every other line and the file's own line ending.
/// Houdini writes the file sorted, so a new key goes in sorted position.
fn set(text: &str, key: &str, value: &str) -> String {
    let end = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let line = format!("{key} := {value};");
    let mut out: Vec<String> = Vec::new();
    let mut written = false;

    for existing in text.lines() {
        if existing.trim().starts_with(&format!("{key} :=")) {
            out.push(line.clone());
            written = true;
        } else {
            if !written && existing.trim() > line.as_str() && !existing.trim().is_empty() {
                out.push(line.clone());
                written = true;
            }
            out.push(existing.to_string());
        }
    }
    if !written {
        out.push(line);
    }
    let mut text = out.join(end);
    text.push_str(end);
    text
}

fn remove(text: &str, key: &str) -> String {
    let end = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let kept: Vec<&str> = text
        .lines()
        .filter(|line| !line.trim().starts_with(&format!("{key} :=")))
        .collect();
    let mut text = kept.join(end);
    if !text.is_empty() {
        text.push_str(end);
    }
    text
}

fn quoted(value: &str) -> String {
    format!("\"{value}\"")
}

/// One copy of the reader's own file, made before this app first writes it.
/// A later apply must not overwrite it, or the original is lost.
fn backup(file: &Path) -> Result<(), String> {
    let kept = file.with_extension("pref.houdinimd-backup");
    if kept.exists() || !file.exists() {
        return Ok(());
    }
    std::fs::copy(file, &kept)
        .map(|_| ())
        .map_err(|e| format!("{}: {e}", kept.display()))
}

fn read(file: &Path) -> Option<String> {
    std::fs::read(file).ok().map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

fn write(file: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    std::fs::write(file, text).map_err(|e| format!("{}: {e}", file.display()))
}

fn load(data: &Path) -> Record {
    read(&data.join(RECORD))
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(data: &Path, record: &Record) -> Result<(), String> {
    let text = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    write(&data.join(RECORD), &text)
}

/// `houdini22.0` names release `22.0`. On macOS the folder is `22.0` itself.
fn series(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    let rest = if cfg!(target_os = "macos") { name } else { name.strip_prefix("houdini")? };
    rest.starts_with(|c: char| c.is_ascii_digit()).then(|| rest.to_string())
}

fn parts(release: &str) -> Vec<u32> {
    release.split('.').filter_map(|part| part.parse().ok()).collect()
}

/// Where Houdini keeps one preferences directory per release.
///
/// On Windows this is `Documents`, not the home directory. A shell that sets
/// `HOME` — Git Bash does — moves Houdini's idea of it, so the environment
/// wins where it is set and the documented default is the fallback.
#[cfg(windows)]
fn prefs_root() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOUDINI_USER_PREF_DIR").map(PathBuf::from) {
        return home.parent().map(Path::to_path_buf);
    }
    let profile = std::env::var_os("USERPROFILE")?;
    Some(PathBuf::from(profile).join("Documents"))
}

#[cfg(target_os = "macos")]
fn prefs_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Preferences/houdini"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn prefs_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Whether a Houdini of this release is open. It rewrites `houdini.pref` when
/// it exits, so a write made while it runs is thrown away without a word.
#[cfg(windows)]
fn running(_release: &str) -> bool {
    // Houdini's own name is the only one that matters: hython does not save
    // preferences.
    process_named("houdini.exe")
}

/// Each edition has its own executable inside its `.app`. The match is on the
/// whole name, so this app's own `houdinimd` does not count.
#[cfg(target_os = "macos")]
fn running(_release: &str) -> bool {
    const NAMES: [&str; 6] = ["houdini", "houdinifx", "houdinicore", "hindie", "happrentice", "hescape"];
    let Ok(out) = std::process::Command::new("ps").args(["-axo", "comm="]).output() else {
        return false;
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|path| path.trim().rsplit('/').next())
        .any(|name| NAMES.contains(&name))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn running(_release: &str) -> bool {
    false
}

#[cfg(windows)]
fn process_named(name: &str) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{EnumProcesses, GetModuleBaseNameA};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let mut ids = vec![0u32; 2048];
    let mut used = 0u32;
    let size = (ids.len() * size_of::<u32>()) as u32;
    if unsafe { EnumProcesses(ids.as_mut_ptr(), size, &mut used) } == 0 {
        return false;
    }
    let count = used as usize / size_of::<u32>();

    for &id in &ids[..count] {
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
        if handle.is_null() {
            continue;
        }
        let mut buffer = [0u8; 260];
        let length =
            unsafe { GetModuleBaseNameA(handle, std::ptr::null_mut(), buffer.as_mut_ptr(), buffer.len() as u32) };
        unsafe { CloseHandle(handle) };
        if length > 0 {
            let found = String::from_utf8_lossy(&buffer[..length as usize]).to_lowercase();
            if found == name {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "anim.slope.val := 0;\r\nmisc.helpaddress.val := \"0.0.0.0\";\r\nui.parm.help := 1;\r\n";

    #[test]
    fn a_missing_key_lands_in_sorted_position() {
        let out = set(SAMPLE, EXTERNAL_URL, "\"http://localhost:48800\"");
        let keys: Vec<&str> = out.lines().map(|l| l.split(" :=").next().unwrap()).collect();
        assert_eq!(
            keys,
            vec!["anim.slope.val", "misc.externalhelpurl.val", "misc.helpaddress.val", "ui.parm.help"]
        );
    }

    #[test]
    fn an_existing_key_is_replaced_in_place() {
        let out = set(SAMPLE, "misc.helpaddress.val", "\"127.0.0.1\"");
        assert_eq!(out.lines().count(), 3);
        assert_eq!(value(&out, "misc.helpaddress.val").as_deref(), Some("\"127.0.0.1\""));
    }

    #[test]
    fn the_file_keeps_its_own_line_ending() {
        assert!(set(SAMPLE, USE_EXTERNAL, "1").contains("\r\n"));
        assert!(!set("a.val := 1;\n", USE_EXTERNAL, "1").contains('\r'));
    }

    #[test]
    fn applying_twice_writes_the_same_file() {
        let once = set(&set(SAMPLE, USE_EXTERNAL, "1"), EXTERNAL_URL, "\"http://localhost:48800\"");
        let twice = set(&set(&once, USE_EXTERNAL, "1"), EXTERNAL_URL, "\"http://localhost:48800\"");
        assert_eq!(once, twice);
    }

    #[test]
    fn reverting_puts_back_exactly_what_was_there() {
        let previous = Previous {
            prefs: PathBuf::new(),
            use_external: value(SAMPLE, USE_EXTERNAL),
            url: value(SAMPLE, EXTERNAL_URL),
        };
        let hooked = set(&set(SAMPLE, USE_EXTERNAL, "1"), EXTERNAL_URL, "\"http://localhost:48800\"");
        assert_eq!(apply_previous(&hooked, &previous), SAMPLE);
    }

    #[test]
    fn a_key_the_reader_never_had_is_removed_not_defaulted() {
        let hooked = set(SAMPLE, USE_EXTERNAL, "1");
        assert!(hooked.contains(USE_EXTERNAL));
        assert!(!remove(&hooked, USE_EXTERNAL).contains(USE_EXTERNAL));
    }


    #[test]
    fn our_url_is_recognised_by_host_and_port() {
        assert!(is_ours("\"http://localhost:48800\"", 48800));
        assert!(is_ours("http://127.0.0.1:48800/", 48800));
        assert!(!is_ours("\"https://houdinimd.com\"", 48800));
    }
}
