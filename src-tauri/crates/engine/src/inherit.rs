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
    pub parent: Option<String>,
    /// A doc-group name, not a class: the anchor a family-less page's
    /// siblings hang from. It renders as muted text, never as a link.
    pub label: bool,
    /// The class the sibling group hangs from: the chain's last class. The
    /// renderer keys the wires on it.
    pub anchor: bool,
}

#[derive(Clone)]
struct ClassInfo {
    superclass: Option<String>,
    groups: Vec<String>,
}

static CLASSES: LazyLock<Mutex<HashMap<PathBuf, Arc<HashMap<String, ClassInfo>>>>> =
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
                    let groups = wiki::model::prop(&props, "group").unwrap_or_default()
                        .split_whitespace().map(str::to_string).collect();
                    found.insert(format!("hou.{name}"), ClassInfo {
                        superclass: wiki::model::prop(&props, "superclass").map(str::to_string),
                        groups,
                    });
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
        next = classes.get(name).and_then(|info| info.superclass.as_deref());
    }
    ancestors.reverse();
    let parent = wiki::model::prop(props, "superclass");
    let parent_of = |name: &str| classes.get(name).and_then(|info| info.superclass.as_deref());
    let children_of = |parent_name: &str| {
        let mut found: Vec<&str> = classes.iter().filter_map(|(name, info)|
            (info.superclass.as_deref() == Some(parent_name)).then_some(name.as_str())
        ).collect();
        found.sort_unstable();
        found
    };
    let mut chain_len = ancestors.len();
    let mut label: Option<&str> = None;
    let (siblings, descendants) = if parent.is_some() {
        // The page's own level can hold it alone. A family's pages share one
        // diagram, so the tree widens to the nearest level above that holds
        // siblings, with the page nested inside it.
        let mut level = ancestors.len() - 1;
        let mut siblings = children_of(ancestors[level]);
        while siblings.len() <= 1 && level > 0 {
            level -= 1;
            siblings = children_of(ancestors[level]);
        }
        let mut descendants: Vec<&str> = classes.iter().filter_map(|(name, info)| {
            let base = info.superclass.as_deref()?;
            (siblings.contains(&base) && !siblings.contains(&name.as_str()) && !ancestors.contains(&name.as_str())).then_some(name.as_str())
        }).collect();
        descendants.sort_unstable();
        if siblings.len() > 1 && (siblings.contains(&own.as_str()) || descendants.contains(&own.as_str())) {
            chain_len = level + 1;
            (siblings, descendants)
        } else {
            // Every level holds the page alone: the chain with its own
            // children is all the family there is.
            chain_len = ancestors.len();
            (Vec::new(), children_of(&own))
        }
    } else {
        // Family-less: no superclass. The doc group's classes stand in as
        // the siblings, and the group's name anchors them the way a parent
        // class anchors real siblings.
        let Some(own_info) = classes.get(&own) else { return Vec::new(); };
        let own_groups = &own_info.groups;
        let mut siblings: Vec<&str> = classes.iter().filter_map(|(name, info)|
            (name != &own && info.groups.iter().any(|group| own_groups.contains(group))).then_some(name.as_str())
        ).collect();
        siblings.push(&own);
        siblings.sort_unstable();
        let mut descendants: Vec<&str> = classes.iter().filter_map(|(name, info)| {
            let base = info.superclass.as_deref()?;
            (siblings.contains(&base) && !siblings.contains(&name.as_str()) && !ancestors.contains(&name.as_str())).then_some(name.as_str())
        }).collect();
        descendants.sort_unstable();
        if siblings.len() > 1 { label = own_info.groups.first().map(String::as_str); }
        (siblings, descendants)
    };
    if label.is_none() && siblings.len() <= 1 && ancestors.is_empty() && descendants.is_empty() { return Vec::new(); }
    let depth = chain_len;
    let mut items: Vec<Class> = ancestors.iter().enumerate()
        .take_while(|(index, _)| *index < depth)
        .map(|(index, name)| class(name, index, false, parent_of(name), false))
        .collect();
    if parent.is_some() && siblings.len() > 1 {
        items.last_mut().expect("the group's parent sits at the chain's end").anchor = true;
    }
    if let Some(name) = label {
        let mut anchor_item = class(name, depth, false, None, true);
        anchor_item.anchor = true;
        items.push(anchor_item);
    }
    if siblings.len() > 1 {
        items.extend(siblings.into_iter().map(|name| class(name, depth, name == own, parent_of(name), false)));
        items.extend(descendants.into_iter().map(|name| class(name, depth + 1, name == own, parent_of(name), false)));
    } else {
        items.push(class(&own, depth, true, parent_of(&own), false));
        items.extend(descendants.into_iter().map(|name| class(name, depth + 1, false, parent_of(name), false)));
    }
    items
}

fn class(name: &str, depth: usize, current: bool, parent: Option<&str>, label: bool) -> Class {
    let path = if label { String::new() } else { format!("/hom/{}", name.replace('.', "/")) };
    Class { name: name.to_string(), path, depth, current, parent: parent.map(str::to_string), label, anchor: false }
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
