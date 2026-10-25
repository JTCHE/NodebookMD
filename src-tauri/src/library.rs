//! What the reader kept and what they read, in `user.db`.
//!
//! Recents and bookmarks are the same shape — a page, by the little the UI
//! needs to draw a row for it — so they are one module. A bookmark names the
//! page, never the page in one build: no `build` column here.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Past this, the oldest recent falls off. A reader walks a handful of pages;
/// a list longer than the panel can ever show is a list nobody reads.
const RECENTS_KEEP: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Which VISIT this is. A recent has one; a bookmark does not, because a
    /// page is kept once and `path` names it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    pub path: String,
    pub title: String,
    pub icon: Option<String>,
    /// Epoch milliseconds — when it was read, or when it was kept.
    pub at: i64,
}

pub fn recents(db: &Connection) -> Result<Vec<Entry>, String> {
    read(db, "id, path, title, icon, at", "recents", "at")
}

pub fn bookmarks(db: &Connection) -> Result<Vec<Entry>, String> {
    read(db, "NULL, path, title, icon, added", "bookmarks", "added")
}

fn read(db: &Connection, columns: &str, table: &str, time_column: &str) -> Result<Vec<Entry>, String> {
    let mut statement = db
        .prepare(&format!(
            "SELECT {columns} FROM user.{table} ORDER BY {time_column} DESC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Entry {
                id: row.get(0)?,
                path: row.get(1)?,
                title: row.get(2)?,
                icon: row.get(3)?,
                at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// Records one visit to a page. A page already in the trail just moves to the
/// top with a fresh `at`, rather than getting a second line; the list is
/// trimmed to `RECENTS_KEEP` here, in the one place that writes it. Returns
/// the row's id, so the caller can offer to forget it right away.
pub fn record_visit(db: &Connection, entry: &Entry) -> Result<i64, String> {
    let id = db
        .query_row(
            "INSERT INTO user.recents (path, title, icon, at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET title = excluded.title, icon = excluded.icon, at = excluded.at
             RETURNING id",
            rusqlite::params![entry.path, entry.title, entry.icon, entry.at],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM user.recents WHERE id NOT IN (
           SELECT id FROM user.recents ORDER BY at DESC, id DESC LIMIT ?1
         )",
        [RECENTS_KEEP as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

/// Drops one VISIT from the trail. The trail is the reader's, so they get to
/// take a line out of it — one line, not every visit to that page.
pub fn forget(db: &Connection, id: i64) -> Result<(), String> {
    db.execute("DELETE FROM user.recents WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Keeps a page, or lets it go. Returns what the page is after the call.
pub fn toggle_bookmark(db: &Connection, entry: &Entry) -> Result<bool, String> {
    let removed = db
        .execute("DELETE FROM user.bookmarks WHERE path = ?1", [&entry.path])
        .map_err(|e| e.to_string())?;
    if removed > 0 {
        return Ok(false);
    }
    db.execute(
        "INSERT INTO user.bookmarks (path, title, icon, added) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![entry.path, entry.title, entry.icon, entry.at],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let data = std::env::temp_dir()
            .join(format!("nodebookmd-library-test-{}-{n}", std::process::id()));
        crate::db::open(&data).unwrap()
    }

    fn entry(path: &str, at: i64) -> Entry {
        Entry { id: None, path: path.to_string(), title: path.to_string(), icon: None, at }
    }

    #[test]
    fn a_bookmark_toggles_off_and_on() {
        let db = db();
        let e = entry("nodes/sop/box", 1);
        assert!(toggle_bookmark(&db, &e).unwrap());
        assert_eq!(bookmarks(&db).unwrap().len(), 1);
        assert!(!toggle_bookmark(&db, &e).unwrap());
        assert_eq!(bookmarks(&db).unwrap().len(), 0);
    }

    /// A page read twice is one line, moved to the top with the later time.
    #[test]
    fn a_revisited_page_moves_to_the_top_instead_of_duplicating() {
        let db = db();
        record_visit(&db, &entry("a", 1)).unwrap();
        record_visit(&db, &entry("b", 2)).unwrap();
        let id = record_visit(&db, &entry("a", 3)).unwrap();
        let all = recents(&db).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].path, "a");
        assert_eq!(all[0].at, 3);
        assert_eq!(all[0].id, Some(id));

        forget(&db, id).unwrap();
        let left = recents(&db).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].path, "b");
    }

    /// The whole point of the move to `user.db`: the window and Houdini's help
    /// pane are two processes, each with their own connection, reading and
    /// writing the same file. This opens two, the way the two surfaces do.
    #[test]
    fn two_connections_to_the_same_data_dir_share_a_bookmark() {
        use std::sync::atomic::{AtomicU32, Ordering};
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let data = std::env::temp_dir()
            .join(format!("nodebookmd-library-shared-test-{}-{n}", std::process::id()));

        let window = crate::db::open(&data).unwrap();
        let pane = crate::db::open(&data).unwrap();

        toggle_bookmark(&window, &entry("nodes/sop/box", 1)).unwrap();
        assert_eq!(bookmarks(&pane).unwrap().len(), 1, "the pane should see the window's bookmark");

        forget(&pane, -1).unwrap(); // a write from the other side, exercised too
        record_visit(&pane, &entry("nodes/sop/box", 2)).unwrap();
        assert_eq!(recents(&window).unwrap().len(), 1, "the window should see the pane's visit");
    }

    #[test]
    fn recents_are_capped() {
        let db = db();
        for i in 0..(RECENTS_KEEP + 10) {
            record_visit(&db, &entry(&format!("p{i}"), i as i64)).unwrap();
        }
        assert_eq!(recents(&db).unwrap().len(), RECENTS_KEEP);
    }
}
