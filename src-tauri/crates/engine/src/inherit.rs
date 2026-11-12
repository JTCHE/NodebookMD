//! The methods a class page gets from the classes above it.
//!
//! A Python class page names its parent with `#superclass:` and nothing more.
//! SideFX's own doc build reads that marker and writes one "Methods from X"
//! section per ancestor, so the page shows every call the reader can make on
//! the object. The page source carries none of it, so a class that adds no
//! method of its own reaches the reader with an empty body. See spec:
//! Local — Some pages come back with an empty body.
//!
//! Not in the `wiki` crate: the crate reads no file, and this reads the
//! ancestor pages. Same reason as `family.rs`. See `agents/architecture.md`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use wiki::Block;

#[derive(serde::Serialize)]
pub struct Class {
    pub name: String,
    pub path: String,
    pub depth: usize,
    pub current: bool,
}

static CLASSES: LazyLock<Mutex<HashMap<PathBuf, Arc<HashMap<String, Option<String>>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The class tree is built from the installed help, independently of the index.
pub fn hierarchy(help: &Path, path: &str, props: &wiki::Props) -> Vec<Class> {
    if wiki::model::prop(props, "type") != Some("homclass") || !path.starts_with("hom/hou/") {
        return Vec::new();
    }
    let zip = help.join("hom.zip");
    let classes = {
        let mut cache = CLASSES.lock().expect("class cache is not poisoned");
        cache.entry(zip.clone()).or_insert_with(|| {
            let mut found = HashMap::new();
            for entry in crate::help::entries(&zip, "hou/") {
                let Some(name) = entry.strip_prefix("hou/").and_then(|s| s.strip_suffix(".txt")) else { continue };
                if name.contains('/') { continue; }
                let Some(source) = crate::help::text(&zip, &entry) else { continue };
                let head = source.lines().take_while(|line| {
                    let line = line.trim();
                    line.is_empty() || line.starts_with('=') || line.starts_with('#')
                }).collect::<Vec<_>>().join("\n");
                let (props, _) = wiki::blocks::parse_source(&head);
                if wiki::model::prop(&props, "type") == Some("homclass") {
                    found.insert(format!("hou.{name}"), wiki::model::prop(&props, "superclass").map(str::to_string));
                }
            }
            Arc::new(found)
        }).clone()
    };
    let own = format!("hou.{}", path.trim_start_matches("hom/hou/"));
    let mut ancestors = Vec::new();
    let mut next = wiki::model::prop(props, "superclass");
    while let Some(name) = next {
        if name == own || ancestors.contains(&name) { break; }
        ancestors.push(name);
        next = classes.get(name).and_then(|parent| parent.as_deref());
    }
    ancestors.reverse();
    let mut children: Vec<&str> = classes.iter().filter_map(|(name, parent)|
        (parent.as_deref() == Some(own.as_str())).then_some(name.as_str())
    ).collect();
    children.sort_unstable();
    if ancestors.is_empty() && children.is_empty() { return Vec::new(); }
    let depth = ancestors.len();
    ancestors.into_iter().enumerate().map(|(depth, name)| class(name, depth, false))
        .chain(std::iter::once(class(&own, depth, true)))
        .chain(children.into_iter().map(|name| class(name, depth + 1, false)))
        .collect()
}

fn class(name: &str, depth: usize, current: bool) -> Class {
    Class { name: name.to_string(), path: format!("/hom/{}", name.replace('.', "/")), depth, current }
}

/// How far up the chain to walk. A `hou` class is three or four deep. The cap
/// is what stops a source that names an ancestor already on the chain.
const DEPTH: usize = 8;

/// Appends one section per ancestor that has methods, nearest ancestor first.
///
/// `section` is the first part of the page's own path — `tops` for
/// `tops/pdg/WorkItemDataType` — because a superclass is written in dotted
/// form, `pdg.BaseType`, and lives beside its child under the same section.
pub fn append(help: &Path, section: &str, props: &wiki::Props, blocks: &mut Vec<Block>) {
    let mut next = wiki::model::prop(props, "superclass").map(str::to_string);
    let mut walked: Vec<String> = Vec::new();
    for _ in 0..DEPTH {
        let Some(name) = next.take() else {
            break;
        };
        if walked.contains(&name) {
            break;
        }
        walked.push(name.clone());
        let path = format!("{section}/{}", name.replace('.', "/"));
        let Ok(source) = crate::help::page(help, &path) else {
            break;
        };
        let (props, parsed) = wiki::blocks::parse_source(&source);
        if let Some(children) = methods(parsed) {
            blocks.push(Block::Section {
                // The name is what the renderer switches on, so it stays
                // `methods`. The title is what the reader sees, and it has to
                // say WHICH class these came from.
                name: "methods".to_string(),
                title: Some(vec![wiki::Inline::Text {
                    text: format!("Methods from {name}"),
                }]),
                props: Vec::new(),
                children,
            });
        }
        next = wiki::model::prop(&props, "superclass").map(str::to_string);
    }
}

fn methods(blocks: Vec<Block>) -> Option<Vec<Block>> {
    blocks.into_iter().find_map(|block| match block {
        Block::Section { name, children, .. } if name == "methods" && !children.is_empty() => {
            Some(children)
        }
        _ => None,
    })
}
