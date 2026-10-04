//! Resolves `:include path#id:` into the block it names.
//!
//! SideFX resolves includes when it builds the docs, so a reference is never
//! what the reader sees. A page such as Geometry OBJ is almost nothing but
//! includes: left unresolved it holds about a hundredth of its text.
//!
//! See spec: Local — Include directives are never resolved.

use std::sync::Arc;

use crate::model::{Block, Inline, LinkTarget, prop};

/// How deep one include may reach through other includes. Four is past
/// anything the install holds and stops a chain that loops through a page
/// this pass has not seen yet.
const DEPTH: usize = 4;

/// Reads a page by path, such as `nodes/sop/box`, parsed. `None` where this
/// build holds no such page. Parsed, not source, so a caller that reads many
/// pages can parse each included page once: the index pass includes the same
/// few pages thirteen thousand times.
pub type Load<'a> = dyn Fn(&str) -> Option<Arc<Vec<Block>>> + 'a;

/// The path an `:includeprop name:` stands for. It is no page: the property
/// lives on one of `PROP_PAGES`, as a definition whose `#hprop:` is `name`.
pub const PROPS: &str = "/props";
// ponytail: the two pages that hold every property an install includes;
// read props/index for the list if a build adds a third.
const PROP_PAGES: [&str; 2] = ["props/mantra", "props/viewport"];

fn prop_page(name: Option<&str>, load: &Load) -> Option<String> {
    let name = name?;
    PROP_PAGES
        .iter()
        .find(|page| load(page).is_some_and(|blocks| find(&mut Vec::clone(&blocks), name).is_some()))
        .map(|page| page.to_string())
}

/// Replaces every include in `blocks` with the content it points at. `page` is
/// the path the blocks were read from, which relative include paths stand on.
///
/// An include that names nothing readable is left as it is, so a missing page
/// reads as a gap and never as silence.
pub fn resolve(blocks: &mut Vec<Block>, page: &str, load: &Load) {
    let mut open = vec![clean(page)];
    expand(blocks, &clean(page), load, &mut open, 0);
}

fn expand(blocks: &mut Vec<Block>, from: &str, load: &Load, open: &mut Vec<String>, depth: usize) {
    let mut out: Vec<Block> = Vec::with_capacity(blocks.len());
    for mut block in blocks.drain(..) {
        if let Block::Include {
            path,
            block_id,
            contents_only,
        } = &block
        {
            let target = match path.as_str() {
                PROPS => prop_page(block_id.as_deref(), load).unwrap_or_default(),
                _ => absolute(from, path),
            };
            // A page includes one of its own blocks by ID alone. That is a
            // reference, not a loop, so the open list does not bar it.
            let same_page = target == *from && block_id.is_some();
            if depth < DEPTH
                && (same_page || !open.contains(&target))
                && let Some(mut found) = pull(&target, block_id.as_deref(), *contents_only, load)
            {
                open.push(target.clone());
                expand(&mut found, &target, load, open, depth + 1);
                open.pop();
                rebase(&mut found, dir(&target));
                out.extend(found);
                continue;
            }
            out.push(block);
            continue;
        }
        borrow(&mut block, from, load, open, depth);
        for children in children(&mut block) {
            expand(children, from, load, open, depth);
        }
        out.push(block);
    }
    *blocks = out;
}

/// A parameter written as `#contentfrom: /nodes/dop/volumesource#voperator#`
/// and no text of its own takes the text of the parameter it names, the way
/// an include does. One with text of its own keeps it.
fn borrow(block: &mut Block, from: &str, load: &Load, open: &mut Vec<String>, depth: usize) {
    let Block::Definition { props, children, .. } = block else { return };
    if !children.is_empty() || depth >= DEPTH {
        return;
    }
    let Some((path, id)) = prop(props, "contentfrom").and_then(|link| link.split_once('#')) else {
        return;
    };
    // `#id=karma:global:autoraybias` names what `#karma:global:autoraybias` does.
    let id = id.strip_prefix("id=").unwrap_or(id);
    let target = absolute(from, path);
    if target != *from && open.contains(&target) {
        return;
    }
    let Some(page) = load(&target) else { return };
    let mut page = Vec::clone(&*page);
    open.push(target.clone());
    // The block alone where the page writes it out. Where the page only
    // includes it from a third page, the page is expanded first to reach it.
    let found = match named(&mut page, id) {
        Some(block) => Some(block),
        None if target != *from => {
            expand(&mut page, &target, load, open, depth + 1);
            named(&mut page, id)
        }
        None => None,
    };
    let Some(found) = found else {
        open.pop();
        return;
    };
    // Expanded as a block, so a parameter that itself borrows is filled.
    let mut found = vec![found];
    expand(&mut found, &target, load, open, depth + 1);
    open.pop();
    rebase(&mut found, dir(&target));
    if let Some(Block::Definition { children: text, .. }) = found.pop() {
        *children = text;
    }
}

/// The block an ID names, or else the definition whose term it is: the VEX
/// context pages name a global by its term alone (`::Cl:`).
fn named(blocks: &mut Vec<Block>, id: &str) -> Option<Block> {
    find(blocks, id).or_else(|| find_term(blocks, id))
}

fn find_term(blocks: &mut Vec<Block>, id: &str) -> Option<Block> {
    for at in 0..blocks.len() {
        if let Block::Definition { term, .. } = &blocks[at]
            && crate::inline::plain(term).trim().trim_matches(':') == id
        {
            return Some(blocks.remove(at));
        }
    }
    for block in blocks {
        for children in children(block) {
            if let Some(found) = find_term(children, id) {
                return Some(found);
            }
        }
    }
    None
}

/// The blocks of `target`, or the one block named by `id` inside it.
fn pull(target: &str, id: Option<&str>, contents_only: bool, load: &Load) -> Option<Vec<Block>> {
    let mut blocks = Vec::clone(&*load(target)?);
    let Some(id) = id else {
        return Some(blocks);
    };
    let mut block = find(&mut blocks, id)?;
    if !contents_only {
        return Some(vec![block]);
    }
    // The trailing slash asks for what is under the block, not the block. A
    // block with nothing under it gives nothing, which is what it holds.
    Some(children(&mut block).into_iter().flat_map(std::mem::take).collect())
}

/// Depth-first, because an ID is unique on a page and the shallowest match is
/// the one a writer means.
fn find(blocks: &mut Vec<Block>, id: &str) -> Option<Block> {
    for at in 0..blocks.len() {
        let hprop = match &blocks[at] {
            Block::Definition { props, .. } => prop(props, "hprop"),
            _ => None,
        };
        if identifier(&blocks[at]) == Some(id) || hprop == Some(id) {
            return Some(blocks.remove(at));
        }
    }
    for block in blocks {
        for children in children(block) {
            if let Some(found) = find(children, id) {
                return Some(found);
            }
        }
    }
    None
}

/// What `#id` on an include can name. `@parameters` answers to `parameters`;
/// everything else carries an explicit ID, either in the markup of a heading
/// or as an `#id:` property.
fn identifier(block: &Block) -> Option<&str> {
    match block {
        Block::Heading { id: Some(id), .. } | Block::Definition { id: Some(id), .. } => {
            Some(id.as_str())
        }
        Block::Section { name, .. } => Some(name.as_str()),
        Block::Heading { props, .. }
        | Block::Definition { props, .. }
        | Block::Item { props, .. }
        | Block::Divider { props, .. } => prop(props, "id"),
        // `parameters id="maskparms">>` is how the COP pages mark a block for
        // including. The ID is an HTML attribute, not a wiki property.
        Block::Html { attributes, .. } => attribute(attributes, "id"),
        _ => None,
    }
}

/// `id="maskparms"` out of a tag's attributes.
fn attribute<'a>(attributes: &'a str, name: &str) -> Option<&'a str> {
    let at = attributes.find(&format!("{name}=\""))? + name.len() + 2;
    let rest = &attributes[at..];
    Some(&rest[..rest.find('"')?])
}

/// Every list of blocks nested inside one block.
fn children(block: &mut Block) -> Vec<&mut Vec<Block>> {
    match block {
        Block::Heading { children, .. }
        | Block::Section { children, .. }
        | Block::Definition { children, .. }
        | Block::Item { children, .. }
        | Block::Usage { children, .. }
        | Block::Subtopic { children, .. }
        | Block::Divider { children, .. }
        | Block::Html { children, .. } => vec![children],
        Block::Bullets { items } | Block::Numbers { items } => {
            items.iter_mut().map(|item| &mut item.blocks).collect()
        }
        Block::Table { rows } => rows
            .iter_mut()
            .flat_map(|row| row.iter_mut().map(|cell| &mut cell.blocks))
            .collect(),
        _ => Vec::new(),
    }
}

/// `nodes/sop` for `nodes/sop/box`.
fn dir(page: &str) -> &str {
    page.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// The include path as a page path. `/shelf/box` is already one; `_common`
/// stands beside the page that includes it.
fn absolute(from: &str, path: &str) -> String {
    if path.is_empty() {
        return from.to_string();
    }
    let joined = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("{}/{path}", dir(from))
    };
    clean(&joined)
}

/// Drops the edge slashes and walks out the `.` and `..` segments.
fn clean(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts.join("/")
}

/// Included blocks keep the references they were written with, and those
/// stand on the page they came from. Once the block moves, a relative
/// reference points at the wrong folder, so it is made absolute here.
fn rebase(blocks: &mut [Block], dir: &str) {
    for block in blocks {
        match block {
            Block::Paragraph { text } | Block::Summary { text } => rebase_inline(text, dir),
            Block::Item { label, props, .. } => {
                rebase_inline(label, dir);
                for (key, value) in props.iter_mut() {
                    if key == "src" {
                        *value = at(dir, value);
                    }
                }
            }
            Block::Definition { term, .. } => rebase_inline(term, dir),
            Block::Subtopic { link, .. } => rebase_inline(link, dir),
            Block::Heading { title, .. } => rebase_inline(&mut title.main, dir),
            _ => {}
        }
        for children in children(block) {
            rebase(children, dir);
        }
    }
}

fn rebase_inline(inlines: &mut [Inline], dir: &str) {
    for inline in inlines {
        match inline {
            Inline::Image { src } => *src = at(dir, src),
            Inline::Link { text, target } => {
                if let LinkTarget::Wiki { path, .. } = target
                    && !path.is_empty()
                {
                    *path = at(dir, path);
                }
                rebase_inline(text, dir);
            }
            Inline::Bold { body } | Inline::Italic { body } | Inline::Ui { body } => {
                rebase_inline(body, dir)
            }
            _ => {}
        }
    }
}

/// A relative reference, read from `dir`. Anything already absolute, and
/// anything that is not a path at all, is left alone.
fn at(dir: &str, src: &str) -> String {
    if src.is_empty() || src.starts_with('/') || src.contains(':') {
        return src.to_string();
    }
    format!("/{}", clean(&format!("{dir}/{src}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(path: &str) -> Option<Arc<Vec<Block>>> {
        source(path).map(|source| Arc::new(crate::parse(&source).blocks))
    }

    fn source(path: &str) -> Option<String> {
        match path {
            "nodes/sop/_common" => Some(
                "#type: include\n\n\
                 :arg:`<geometry>`:\n    #id: geometry\n\n    Read from here.\n\n\
                 == Placing == (placing)\n\n    Click [it|../lattice].\n\n    [Image:images/a.png]\n"
                    .into(),
            ),
            "shelf/deep" => Some(":include /nodes/sop/_common#geometry:\n".into()),
            "shelf/loop" => Some(":include /shelf/loop:\n".into()),
            "nodes/sop/pyro" => Some(
                "@parameters\n\nOperation:\n    #id: op\n    #contentfrom: /nodes/dop/volumesource#voperator#\n\n\
                 Again:\n    #contentfrom: #op\n\n\
                 Own:\n    #contentfrom: #op\n\n    Its own words.\n"
                    .into(),
            ),
            "nodes/dop/volumesource" => {
                Some("@parameters\n\nOperation:\n    #id: voperator#\n    The merging operation.\n".into())
            }
            _ => None,
        }
    }

    fn blocks(source: &str, page: &str) -> Vec<Block> {
        let mut blocks = crate::parse(source).blocks;
        resolve(&mut blocks, page, &load);
        blocks
    }

    fn text(source: &str, page: &str) -> String {
        crate::markdown::blocks(&blocks(source, page), 1)
    }

    #[test]
    fn pulls_the_block_an_id_names() {
        let out = text(":include _common#geometry:\n", "nodes/sop/box");
        assert!(out.contains("Read from here."), "{out}");
    }

    #[test]
    fn a_trailing_slash_drops_the_block_itself() {
        let whole = text(":include _common#placing:\n", "nodes/sop/box");
        let inner = text(":include _common#placing/:\n", "nodes/sop/box");
        assert!(whole.contains("Placing"), "{whole}");
        assert!(!inner.contains("Placing"), "{inner}");
        assert!(inner.contains("Click"), "{inner}");
    }

    #[test]
    fn relative_references_move_with_the_block() {
        let out = text(":include _common#placing:\n", "nodes/sop/box");
        assert!(out.contains("(/nodes/lattice)"), "{out}");
        assert!(out.contains("/nodes/sop/images/a.png"), "{out}");
    }

    #[test]
    fn an_include_inside_an_include_is_resolved() {
        let out = text(":include /shelf/deep:\n", "nodes/sop/box");
        assert!(out.contains("Read from here."), "{out}");
    }

    #[test]
    fn a_parameter_takes_the_text_it_names_with_contentfrom() {
        let out = text(":include /nodes/sop/pyro:\n", "nodes/sop/box");
        assert_eq!(out.matches("The merging operation.").count(), 2, "{out}");
        assert!(out.contains("Its own words."), "{out}");
    }

    #[test]
    fn a_page_that_includes_itself_stops() {
        let out = text(":include /shelf/loop:\n", "nodes/sop/box");
        assert!(out.contains("<!-- include"), "{out}");
    }

    #[test]
    fn a_missing_page_leaves_the_reference() {
        let out = text(":include /nodes/sop/nothing:\n", "nodes/sop/box");
        assert!(out.contains("<!-- include /nodes/sop/nothing -->"), "{out}");
    }
}
