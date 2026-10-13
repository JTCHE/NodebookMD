//! Ranked search over the index, the title list, and link tooltips.

use serde::Serialize;

use crate::{db, help, install};

/// A page in the title list, and a search hit. The front-end draws both the
/// same way, so they are one shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub title: String,
    pub node_type: Option<String>,
    pub icon: Option<String>,
    /// What the page says it does, shown when nothing under a heading matched.
    pub summary: Option<String>,
    /// The sections of this page that matched, best first. Empty for a
    /// title-list entry, which matched no text at all.
    pub headings: Vec<Section>,
    /// How well the words match, larger being better. The front-end weights
    /// this by what KIND of page it is, which is a question about the reader
    /// and not about the text — see `weight` in `search.ts`. Zero for a
    /// title-list entry.
    pub score: f64,
    /// The sidebar folders above the page, outermost first. Only the title
    /// list carries them. See `place.rs`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub place: Vec<String>,
}

/// One matching section of a page: the row the list nests under it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    /// Empty when the words were above the first heading.
    pub heading: String,
    /// The anchor to open the page at. Empty with an empty heading.
    pub slug: String,
    /// The words themselves, as they read on the page.
    pub excerpt: String,
}

/// What a link hover shows: the page name, and the line under it.
#[derive(Serialize)]
pub struct Meta {
    pub path: String,
    pub title: String,
    pub summary: Option<String>,
    /// The page's own icon, so a link to it can carry the same mark the panel
    /// and the search draw for it.
    pub icon: Option<String>,
}

/// At most this many matching sections are listed under one page. Past three
/// the list is a page of one result, and the reader has stopped comparing.
const SECTIONS_PER_PAGE: usize = 3;

/// A matching section row, with its page. `row_hit` reads it.
const SECTION_ROWS: &str = "SELECT pages_fts.path, p.title, p.node_type, p.icon, p.summary,
                    pages_fts.heading, pages_fts.slug,
                    snippet(pages_fts, 5, '', '', '…', 14),
                    bm25(pages_fts, 0.0, 0.0, 0.0, 4.0, 10.0, 1.0) AS rank
             FROM pages_fts
             JOIN pages p ON p.build = pages_fts.build AND p.path = pages_fts.path
             WHERE pages_fts MATCH ?1 AND pages_fts.build = ?2";

/// Full-text search over the page bodies, ranked with `bm25()`.
///
/// A row of the index is a section, so the ranking is over sections and the
/// pages come out of it: the first section of a page decides where the page
/// sits, and its other matching sections are listed beneath it. That is what
/// the result list draws, and it is why the query asks for more rows than the
/// caller wants pages.
///
/// The title and heading columns are weighted above the body, so a page named
/// for the words beats a page that only mentions them.
pub fn find(
    db: &rusqlite::Connection,
    build: &str,
    query: &str,
    limit: u32,
) -> Result<Vec<Hit>, String> {
    let Some(match_query) = db::match_query(query) else {
        return Ok(Vec::new());
    };
    // A quoted phrase must be in the section as typed, symbols and all.
    let phrases = db::quoted(query);
    let exact: String = (0..phrases.len())
        .map(|i| {
            format!(
                " AND instr(lower(pages_fts.heading || ' ' || pages_fts.title || ' ' || pages_fts.body), ?{})",
                i + 4
            )
        })
        .collect();
    let mut statement = db
        .prepare(
            &format!("{SECTION_ROWS}{exact} ORDER BY rank LIMIT ?3"),
        )
        .map_err(|e| e.to_string())?;

    let wanted = limit as usize;
    let mut values: Vec<rusqlite::types::Value> =
        vec![match_query.into(), build.to_string().into(), ((wanted * SECTIONS_PER_PAGE * 4) as i64).into()];
    values.extend(phrases.iter().cloned().map(Into::into));
    let rows = statement
        .query_map(rusqlite::params_from_iter(values), row_hit)
        .map_err(|e| e.to_string())?;
    let mut hits = group(rows, wanted)?;
    drop(statement);
    if !phrases.is_empty() {
        return Ok(hits);
    }

    // A page the reader named, then a thing on it: "dop network time scale".
    // Its title rides the first section only, so no single row holds all the
    // words and the page never came up. It goes first: the reader said which
    // page they meant.
    let named = named(db, build, query)?;
    if !named.is_empty() {
        let top = hits.iter().map(|hit| hit.score).fold(1.0, f64::max);
        hits.retain(|hit| !named.iter().any(|n| n.path == hit.path));
        hits.splice(0..0, named.into_iter().map(|hit| Hit { score: top * 2.0 + hit.score, ..hit }));
        hits.truncate(wanted);
    }
    Ok(hits)
}

/// The query split as a page's exact title and the words after it (or before
/// it), and the sections of that page that hold those words. Empty when no
/// such split names a page. The longest title wins.
fn named(db: &rusqlite::Connection, build: &str, query: &str) -> Result<Vec<Hit>, String> {
    let words = tokens(query);
    let n = words.len();
    if n < 2 {
        return Ok(Vec::new());
    }
    let mut titled = db
        .prepare("SELECT path, title FROM pages WHERE build = ?1 AND rank = 0 AND title LIKE ?2")
        .map_err(|e| e.to_string())?;
    let mut titles = |these: &[String]| -> Result<Vec<(String, Vec<String>)>, String> {
        let pattern = format!("%{}%", these.join("%"));
        let rows = titled
            .query_map(rusqlite::params![build, pattern], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        Ok(rows.filter_map(Result::ok).map(|(path, title)| (path, tokens(&title))).collect())
    };
    // The whole query is the start of a title ("copy to points"): the reader
    // is naming that page, and the plain ranking already answers it.
    let (last, head) = words.split_last().expect("two words or more");
    let typing = titles(&words)?.into_iter().any(|(_, title)| {
        title.len() >= n && title[..n - 1] == *head && title[n - 1].starts_with(last.as_str())
    });
    if typing {
        return Ok(Vec::new());
    }
    let mut sections = db
        .prepare(
            &format!("{SECTION_ROWS} AND pages_fts.path = ?3 ORDER BY rank LIMIT ?4"),
        )
        .map_err(|e| e.to_string())?;
    for k in (1..n).rev() {
        for (title, rest) in [(&words[..k], &words[k..]), (&words[n - k..], &words[..n - k])] {
            let pages: Vec<String> =
                titles(title)?.into_iter().filter(|(_, name)| name == title).map(|(path, _)| path).collect();
            let Some(match_query) = db::match_query(&rest.join(" ")) else { continue };
            let mut found = Vec::new();
            for path in &pages {
                let rows = sections
                    .query_map(rusqlite::params![match_query, build, path, SECTIONS_PER_PAGE as u32], row_hit)
                    .map_err(|e| e.to_string())?;
                found.extend(group(rows, 1)?);
            }
            if !found.is_empty() {
                return Ok(found);
            }
        }
    }
    Ok(Vec::new())
}

/// Lower-case words, split the way `db::match_query` splits them.
fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '_').filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

fn row_hit(row: &rusqlite::Row) -> rusqlite::Result<(Hit, Section)> {
    Ok((
        Hit {
            path: row.get(0)?,
            title: row.get(1)?,
            node_type: row.get(2)?,
            icon: row.get(3)?,
            summary: row.get(4)?,
            headings: Vec::new(),
            // `bm25()` is more negative the better the match. The front-end
            // multiplies by a weight in 0..1, so the sign is turned here and
            // never there.
            score: -row.get::<_, f64>(8)?,
            place: Vec::new(),
        },
        Section { heading: row.get(5)?, slug: row.get(6)?, excerpt: row.get(7)? },
    ))
}

/// Section rows, best first, as pages with their sections under them.
fn group(
    rows: impl Iterator<Item = rusqlite::Result<(Hit, Section)>>,
    wanted: usize,
) -> Result<Vec<Hit>, String> {
    let mut hits: Vec<Hit> = Vec::new();
    let mut at: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for row in rows {
        let (hit, section) = row.map_err(|e| e.to_string())?;
        let index = match at.get(&hit.path) {
            Some(index) => *index,
            None => {
                if hits.len() == wanted {
                    continue;
                }
                at.insert(hit.path.clone(), hits.len());
                hits.push(hit);
                hits.len() - 1
            }
        };
        if hits[index].headings.len() < SECTIONS_PER_PAGE && !section.excerpt.trim().is_empty() {
            hits[index].headings.push(section);
        }
    }
    Ok(hits)
}

/// Every page title in the current build, one per node: an older version of a
/// node is reached from the selector on its newest page.
///
/// The whole list goes to the front-end once and stays in memory there, which
/// is what makes the pick in the search field instant. It comes in the order
/// the sidebar draws it, so the sidebar never sorts.
pub fn all_titles(db: &rusqlite::Connection, build: &str) -> Result<Vec<Hit>, String> {
    let mut statement = db
        .prepare(
            "SELECT path, title, node_type, icon, summary, place FROM pages
             WHERE build = ?1 AND rank = 0 ORDER BY seq",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([build], |row| {
            Ok(Hit {
                path: row.get(0)?,
                title: row.get(1)?,
                node_type: row.get(2)?,
                icon: row.get(3)?,
                summary: row.get(4)?,
                headings: Vec::new(),
                score: 0.0,
                place: row
                    .get::<_, String>(5)?
                    .split('\n')
                    .filter(|label| !label.is_empty())
                    .map(str::to_string)
                    .collect(),
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

/// The tooltip text for a set of pages, asked for in one call.
///
/// The index answers most of it. A page the background pass has not reached is
/// read and parsed here instead, so a tooltip on a fresh install says the same
/// thing it will say later.
pub fn read_meta(
    db: &rusqlite::Connection,
    install: &install::Install,
    paths: &[String],
) -> Result<Vec<Meta>, String> {
    let build = &install.version;
    let mut found: Vec<Meta> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
    {
        let mut statement = db
            .prepare("SELECT title, summary, icon FROM pages WHERE build = ?1 AND path = ?2")
            .map_err(|e| e.to_string())?;
        for path in paths {
            let row = statement
                .query_row(rusqlite::params![build, path], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .ok();
            match row {
                Some((title, summary, icon)) => found.push(Meta {
                    path: path.clone(),
                    title,
                    summary,
                    icon,
                }),
                None => missing.push(path.clone()),
            }
        }
    }
    if missing.is_empty() {
        return Ok(found);
    }
    let roots = install.help_roots();
    for path in missing {
        let Ok(source) = help::page_layered(&roots, &path) else {
            continue;
        };
        let parsed = wiki::parse(&source);
        found.push(Meta {
            title: crate::page::name(&path, &parsed),
            path,
            summary: crate::page::summary(&parsed),
            icon: wiki::model::prop(&parsed.props, "icon").map(|icon| format!("{icon}.svg")),
        });
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::find;

    /// Two pages, each titled on its first section only, the way `index.rs`
    /// writes them. Made up here: no doc text in the repo.
    fn index() -> rusqlite::Connection {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        crate::db::reset(&db).unwrap();
        for (path, title, sections) in [
            ("net", "Sim Net", [("", "Sim Net", "A network."), ("Timing", "", "Scale Time makes the clock loop fast.")]),
            ("net_long", "Sim Net Long", [("", "Sim Net Long", "Another network."), ("Other", "", "Nothing here.")]),
            ("mentions", "Clock", [("", "Clock", "A sim net can scale time too."), ("More", "", "Nothing.")]),
        ] {
            db.execute("INSERT INTO pages (build, path, title) VALUES ('b', ?1, ?2)", [path, title]).unwrap();
            for (heading, name, body) in sections {
                db.execute(
                    "INSERT INTO pages_fts (build, path, slug, heading, title, body) VALUES ('b', ?1, '', ?2, ?3, ?4)",
                    [path, heading, name, body],
                )
                .unwrap();
            }
        }
        db
    }

    #[test]
    fn a_named_page_and_a_thing_on_it_comes_first() {
        let hits = find(&index(), "b", "sim net scale time", 6).unwrap();
        assert_eq!(hits[0].path, "net");
        assert_eq!(hits[0].headings[0].heading, "Timing");
    }

    #[test]
    fn a_quoted_phrase_keeps_only_sections_that_hold_it() {
        let db = index();
        db.execute("INSERT INTO pages (build, path, title) VALUES ('b', 'sym', 'Sym')", []).unwrap();
        db.execute(
            "INSERT INTO pages_fts (build, path, slug, heading, title, body) VALUES ('b', 'sym', '', '', 'Sym', 'Use `$FF` here.')",
            [],
        )
        .unwrap();
        db.execute(
            "INSERT INTO pages_fts (build, path, slug, heading, title, body) VALUES ('b', 'net', 'x', 'X', '', 'An ff only.')",
            [],
        )
        .unwrap();
        let hits = find(&db, "b", "\"$FF\"", 6).unwrap();
        assert_eq!(hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), ["sym"]);
    }

    #[test]
    fn a_title_being_typed_is_left_to_the_plain_ranking() {
        let hits = find(&index(), "b", "sim net lo", 6).unwrap();
        assert_eq!(hits[0].path, "net_long");
    }
}
