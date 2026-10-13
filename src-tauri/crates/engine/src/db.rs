//! `index.db`: what the engine derives from a Houdini install.
//!
//! Everything here is derived. Delete the file and nothing of the reader's is
//! lost — the background pass fills it again in seconds. The reader's own work
//! lives in `user.db`, which the app owns and this module never touches.
//!
//! See spec: Local — SQLite FTS5 Index.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

/// `index.db` sits in the folder the caller names.
pub fn path(data: &Path) -> PathBuf {
    data.join("index.db")
}

/// Opens `index.db` and makes its schema.
pub fn open(data: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(data).map_err(|e| format!("{}: {e}", data.display()))?;
    let index = path(data);
    let db = Connection::open(&index).map_err(|e| format!("{}: {e}", index.display()))?;

    // 16 KB pages, not 4 KB: the first pass wrote 12% faster and a search ran
    // 20% faster. It takes effect on a new file only; an older file keeps its
    // size, because a file in WAL mode cannot change it.
    db.pragma_update(None, "page_size", 16384)
        .map_err(|e| e.to_string())?;
    // WAL lets the background indexer write while the reader reads.
    db.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    db.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| e.to_string())?;
    // 512 KB, not SQLite's 2 MB: the probe measured -4 MB and no slower search.
    db.pragma_update(None, "cache_size", -512)
        .map_err(|e| e.to_string())?;

    reset_if_stale(&db)?;
    db.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    Ok(db)
}

/// What `SCHEMA` describes. Raise it whenever the derived tables change shape,
/// or the parser writes different rows into them.
const VERSION: u32 = 9;

/// Throws away everything derived from the Houdini install when the shape it
/// was written in is not the shape this build reads. `index.db` is derived, so
/// there is nothing here to migrate — the background pass fills it again in
/// seconds.
fn reset_if_stale(db: &Connection) -> Result<(), String> {
    let found: u32 = db
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if found != VERSION {
        drop_all(db)?;
        db.pragma_update(None, "user_version", VERSION)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Empties `index.db`: every build, as if the file were new. Dropping the
/// tables takes a moment; deleting the rows of an FTS5 table one at a time
/// took seconds.
pub fn reset(db: &Connection) -> Result<(), String> {
    drop_all(db)?;
    db.execute_batch(SCHEMA).map_err(|e| e.to_string())
}

fn drop_all(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "DROP TABLE IF EXISTS pages;
         DROP TABLE IF EXISTS pages_fts;
         DROP TABLE IF EXISTS builds;",
    )
    .map_err(|e| e.to_string())
}

/// One build is one set of rows, never one file and never one folder. A
/// Houdini upgrade rewrites its own rows and leaves the others alone.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS builds (
  build TEXT PRIMARY KEY,
  -- Written with every write of the pass, so a reader that polls (the help
  -- pane) sees the count climb the way the window's events show it.
  pages INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  -- 0 while the background pass is still filling this build in.
  done  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pages (
  build     TEXT NOT NULL,
  path      TEXT NOT NULL,
  title     TEXT NOT NULL,
  node_type TEXT,
  icon      TEXT,
  summary   TEXT,
  -- The versions of one node. `family` is NULL for a page with no other
  -- version, and `rank` is 0 for the newest page. See `versions.rs`.
  family    TEXT,
  label     TEXT,
  rank      INTEGER NOT NULL DEFAULT 0,
  -- The sidebar folders above the page, one label per line, and the page's
  -- position in the order the sidebar draws its section. See `place.rs`.
  place     TEXT NOT NULL DEFAULT '',
  seq       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (build, path)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS pages_family ON pages (build, family) WHERE family IS NOT NULL;

-- One row per SECTION of a page, not per page: a hit names the heading the
-- reader should land on, which is what the result list draws under the page.
-- Cutting the body at its headings stores it once, not twice — see
-- `sections.rs`.
--
-- `heading` is empty and `title` is set on the row for the text above the first
-- heading, so a page is named exactly once and the title weight cannot multiply
-- with the number of sections it has.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  build   UNINDEXED,
  path    UNINDEXED,
  slug    UNINDEXED,
  heading,
  title,
  body,
  tokenize = "unicode61 remove_diacritics 2"
);
"#;

/// Turns what the reader typed into an FTS5 query.
///
/// Every token is quoted, so a bare `*`, `-` or `NEAR` is text and not syntax.
/// The last token takes a prefix star, because the reader is still typing it.
/// Words in double quotes are one phrase with no star: see `quoted`.
pub fn match_query(text: &str) -> Option<String> {
    let words = |part: &str| -> Vec<String> {
        part.split(|c: char| !c.is_alphanumeric() && c != '_').filter(|t| !t.is_empty()).map(str::to_string).collect()
    };
    let parts: Vec<&str> = text.split('"').collect();
    let mut terms = Vec::new();
    let mut star = false;
    for (i, part) in parts.iter().enumerate() {
        let tokens = words(part);
        if tokens.is_empty() {
            continue;
        }
        if i % 2 == 1 {
            terms.push(format!("\"{}\"", tokens.join(" ")));
            star = false;
        } else {
            terms.extend(tokens.iter().map(|t| format!("\"{t}\"")));
            star = i == parts.len() - 1;
        }
    }
    if terms.is_empty() {
        return None;
    }
    let mut query = terms.join(" ");
    if star {
        query.push('*');
    }
    Some(query)
}

/// The phrases the reader put in double quotes, lower-cased: `"$FF" fetch`
/// gives `$ff`. The index drops symbols, so a hit must also hold each phrase as
/// it was typed. An unclosed quote counts: the reader is typing the phrase.
pub fn quoted(text: &str) -> Vec<String> {
    text.split('"').skip(1).step_by(2).map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    use super::{match_query, quoted};

    #[test]
    fn a_query_quotes_every_token_and_extends_the_last() {
        assert_eq!(match_query("copy to points").unwrap(), "\"copy\" \"to\" \"points\"*");
    }

    #[test]
    fn syntax_the_reader_types_stays_text() {
        assert_eq!(match_query("a OR b*").unwrap(), "\"a\" \"OR\" \"b\"*");
    }

    #[test]
    fn a_quoted_phrase_is_exact_and_takes_no_star() {
        assert_eq!(match_query("\"$FF\"").unwrap(), "\"FF\"");
        assert_eq!(match_query("\"point cloud\" iso").unwrap(), "\"point cloud\" \"iso\"*");
        assert_eq!(quoted("\"$FF\" fetch \"Ab C"), ["$ff", "ab c"]);
    }

    #[test]
    fn nothing_to_match_is_no_query() {
        assert!(match_query("   ").is_none());
    }
}
