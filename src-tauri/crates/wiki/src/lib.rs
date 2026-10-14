//! Reads a SideFX help page in wiki markup and gives back a structure the app
//! can render and index. The markup reference is `help.zip/format.txt`.

pub mod blocks;
pub mod html;
pub mod include;
pub mod inline;
pub mod markdown;
pub mod model;

pub use model::{Block, Entry, HeadingRef, Inline, LinkTarget, Page, Props, Size, Title};

/// Parse one page.
pub fn parse(source: &str) -> Page {
    let (props, mut tree) = blocks::parse_source(source);

    let mut title = Title::default();
    if let Some((page_title, children)) = blocks::take_title(&mut tree) {
        title = page_title;
        let mut body = children;
        body.extend(tree);
        tree = body;
    }

    // The title line carries the page properties under it, so they arrive
    // with the first block group rather than before the title.
    let mut summary = None;
    tree.retain(|block| match block {
        Block::Summary { text } => {
            if summary.is_none() {
                summary = Some(text.clone());
            }
            false
        }
        _ => true,
    });

    let title_text = inline::plain(&title.main);
    let mut page = Page {
        title,
        title_text,
        summary,
        props,
        blocks: tree,
        headings: Vec::new(),
        entries: Vec::new(),
        usages: Vec::new(),
        links: Vec::new(),
        includes: Vec::new(),
    };
    collect(&mut page);
    page
}

pub fn to_html(page: &Page) -> String {
    html::page(page)
}

pub fn to_markdown(page: &Page) -> String {
    markdown::page(page)
}

/// Walk the tree once and lift out what the index and the front-end need.
fn collect(page: &mut Page) {
    let mut found = Found::default();
    walk(&page.blocks, None, &mut found);
    page.headings = found.headings;
    page.entries = found.entries;
    page.usages = found.usages;
    page.links = found.links;
    page.includes = found.includes;
}

#[derive(Default)]
struct Found {
    headings: Vec<HeadingRef>,
    entries: Vec<Entry>,
    usages: Vec<String>,
    links: Vec<LinkTarget>,
    includes: Vec<String>,
}

/// `place` is the `@`-section the blocks sit in and the heading inside it,
/// which is what a parameter folder is. It is `None` outside any section.
fn walk(blocks: &[Block], place: Option<(&str, &str)>, found: &mut Found) {
    for block in blocks {
        match block {
            Block::Heading {
                level,
                id,
                title,
                children,
                ..
            } => {
                let text = markdown::title(title);
                found.headings.push(HeadingRef {
                    level: *level,
                    id: id.clone(),
                    text: text.clone(),
                });
                let place = place.map(|(section, _)| (section, text.as_str()));
                walk(children, place, found);
            }
            Block::Section { name, children, .. } => {
                walk(children, Some((name.as_str(), "")), found);
            }
            Block::Definition {
                term, id, children, ..
            } => {
                if let Some((section, folder)) = place {
                    found
                        .entries
                        .push(entry(section, term, id, folder, children));
                }
                walk(children, place, found);
            }
            Block::Usage {
                signature,
                children,
            } => {
                found.usages.push(signature.clone());
                walk(children, place, found);
            }
            Block::Include { path, .. } => {
                found.includes.push(path.clone());
            }
            Block::Paragraph { text } | Block::Summary { text } => inline_links(text, found),
            Block::Item {
                label, children, ..
            } => {
                inline_links(label, found);
                walk(children, place, found);
            }
            Block::Subtopic { link, children } => {
                inline_links(link, found);
                walk(children, place, found);
            }
            Block::Bullets { items } | Block::Numbers { items } => {
                for item in items {
                    walk(&item.blocks, place, found);
                }
            }
            Block::Table { rows } => {
                for row in rows {
                    for cell in row {
                        walk(&cell.blocks, place, found);
                    }
                }
            }
            Block::Html { children, .. } => walk(children, place, found),
            Block::Divider { children, .. } => walk(children, place, found),
            Block::Code { .. } | Block::RawHtml { .. } => {}
        }
    }
}

fn inline_links(inlines: &[Inline], found: &mut Found) {
    for inline in inlines {
        match inline {
            Inline::Link { text, target } => {
                found.links.push(target.clone());
                inline_links(text, found);
            }
            Inline::Bold { body } | Inline::Italic { body } | Inline::Ui { body } => {
                inline_links(body, found)
            }
            _ => {}
        }
    }
}

fn entry(
    section: &str,
    term: &[Inline],
    id: &Option<String>,
    folder: &str,
    children: &[Block],
) -> Entry {
    let mut help_blocks: Vec<Block> = Vec::new();
    let mut menu: Vec<(String, String)> = Vec::new();
    for block in children {
        match block {
            Block::Definition { term, children, .. } => menu.push((
                inline::plain(term),
                markdown::blocks(children, 1).trim().to_string(),
            )),
            other => help_blocks.push(other.clone()),
        }
    }
    Entry {
        section: section.to_string(),
        label: inline::plain(term),
        id: id.clone(),
        folder: (!folder.is_empty()).then(|| folder.to_string()),
        help: markdown::blocks(&help_blocks, 1).trim().to_string(),
        menu,
    }
}
