//! Markdown for the copy button and for agents.

use crate::model::{prop, Block, IconSize, Inline, LinkTarget, Page, Props, Title};

pub fn page(page: &Page) -> String {
    let mut out = String::new();
    out.push_str("# ");
    out.push_str(&title(&page.title));
    out.push_str("\n\n");
    if let Some(summary) = &page.summary {
        out.push_str(&inlines(summary));
        out.push_str("\n\n");
    }
    out.push_str(&blocks(&page.blocks, 1));
    while out.ends_with('\n') {
        out.pop();
    }
    out.push('\n');
    out
}

pub fn title(title: &Title) -> String {
    let mut parts = Vec::new();
    if let Some(pre) = &title.pre {
        parts.push(inlines(pre));
    }
    parts.push(inlines(&title.main));
    if let Some(sub) = &title.sub {
        parts.push(inlines(sub));
    }
    parts.join(" — ")
}

pub fn blocks(blocks: &[Block], depth: u8) -> String {
    let mut out = String::new();
    let mut run: Vec<&Block> = Vec::new();
    let mut columns: Vec<&Block> = Vec::new();
    for block in blocks {
        if matches!(block, Block::Item { name, .. } if name == "task") {
            flush_columns(&mut columns, &mut out, depth);
            run.push(block);
            continue;
        }
        if matches!(block, Block::Item { name, .. } if name == "col") {
            flush_tasks(&mut run, &mut out);
            columns.push(block);
            continue;
        }
        flush_tasks(&mut run, &mut out);
        flush_columns(&mut columns, &mut out, depth);
        out.push_str(&one(block, depth));
    }
    flush_tasks(&mut run, &mut out);
    flush_columns(&mut columns, &mut out, depth);
    out
}

/// A run of `:col:` blocks sits side by side: two pictures to compare, or two
/// lists of links. Each column stays Markdown — the blank line after an HTML
/// tag hands the text back to the Markdown parser — so a heading or a list in
/// a column still reads as one. See `.columns` in `globals.css`.
fn flush_columns(run: &mut Vec<&Block>, out: &mut String, depth: u8) {
    if run.len() == 1 {
        out.push_str(&one(run[0], depth));
    } else if !run.is_empty() {
        out.push_str("<div class=\"columns\">\n\n");
        for block in run.iter() {
            out.push_str(&format!("<div class=\"column\">\n\n{}\n\n</div>\n\n", one(block, depth).trim_end()));
        }
        out.push_str("</div>\n\n");
    }
    run.clear();
}

/// A run of `:task:` blocks is the "To.../Do this" table SideFX draws for
/// them. Markdown has no `task-desc`/`task-howto` pair of cells, so a table
/// is the closest shape it has; see `parameters()`, which does the same
/// thing for `@parameters` and every other `@`-section of `Term:` entries.
fn flush_tasks(run: &mut Vec<&Block>, out: &mut String) {
    if run.is_empty() {
        return;
    }
    out.push_str("| To... | Do this |\n| --- | --- |\n");
    for block in run.drain(..) {
        let Block::Item { label, children, .. } = block else {
            continue;
        };
        out.push_str(&format!(
            "| {} | {} |\n",
            cell_text(&inlines(label)),
            cell_text(&cell_html(children, false))
        ));
    }
    out.push('\n');
}

fn one(block: &Block, depth: u8) -> String {
    match block {
        Block::Heading {
            level,
            id,
            title: heading,
            children,
            ..
        } => {
            let level = (*level).clamp(2, 6);
            format!(
                "{} {}{}\n\n{}",
                "#".repeat(level as usize),
                anchor(id),
                title(heading),
                blocks(children, depth)
            )
        }
        Block::Section {
            name,
            title: label,
            children,
            ..
        } => {
            let heading = match label {
                Some(label) => inlines(label),
                None => capitalise(name),
            };
            let body = match name.as_str() {
                // `@globals` is a plain type/name/description list, the same
                // shape as `@parameters` — see `parameters()`. Every other
                // `@`-section of `Term:` entries (`methods`, `inputs`,
                // `env_variables`...) draws each entry on its own instead,
                // so only these two take the table path.
                "parameters" | "globals" => parameters(children, depth),
                _ => blocks(children, depth),
            };
            format!("## {heading}\n\n{body}")
        }
        Block::Paragraph { text } => match image_group(text) {
            Some(row) => row,
            None => format!("{}\n\n", inlines(text)),
        },
        Block::Summary { text } => format!("{}\n\n", inlines(text)),
        Block::Bullets { items } => {
            let mut out = String::new();
            for item in items {
                out.push_str(&list_item("-", &blocks(&item.blocks, depth + 1)));
            }
            out.push('\n');
            out
        }
        Block::Numbers { items } => {
            let mut out = String::new();
            for (i, item) in items.iter().enumerate() {
                let marker = format!("{}.", i + 1);
                out.push_str(&list_item(&marker, &blocks(&item.blocks, depth + 1)));
            }
            out.push('\n');
            out
        }
        // The term sits on the line over its text, as a `<dt>` over its `<dd>`.
        // A blank line between them made two paragraphs as far apart as any
        // two, and the term no longer read as the name of the text under it.
        // The hard break holds only before a paragraph: before a list or a
        // code fence the backslash prints.
        Block::Definition { term, id, children, .. } => {
            let tight = matches!(children.first(), Some(Block::Paragraph { text }) if image_group(text).is_none());
            format!(
                "{}**{}**{}{}",
                anchor(id),
                inlines(term),
                if tight { "\\\n" } else { "\n\n" },
                indent(&blocks(children, depth + 1))
            )
        }
        Block::Item {
            name,
            label,
            props,
            children,
            ..
        } => item(name, &inlines(label), props, children, depth),
        Block::Usage {
            signature,
            children,
        } => format!("```vex\n{signature}\n```\n\n{}", blocks(children, depth)),
        Block::Code { language, text } => {
            let language = language.clone().unwrap_or_default();
            format!("```{language}\n{text}\n```\n\n")
        }
        Block::Divider {
            label, children, ..
        } => {
            let body = blocks(children, depth);
            match label {
                Some(label) => format!("---\n\n**{}**\n\n{body}", inlines(label)),
                None => format!("---\n\n{body}"),
            }
        }
        Block::Table { rows } => table(rows, depth),
        Block::Include {
            path,
            block_id,
            contents_only,
        } => {
            let anchor = block_id
                .as_ref()
                .map(|id| format!("#{id}"))
                .unwrap_or_default();
            let slash = if *contents_only { "/" } else { "" };
            format!("<!-- include {path}{anchor}{slash} -->\n\n")
        }
        Block::Subtopic { link, children } => {
            format!(
                "- {}\n{}",
                inlines(link),
                indent(&blocks(children, depth + 1))
            )
        }
        // `tag>>` is SideFX's own pseudo-HTML, not a real element the reader's
        // markdown renderer knows — `<steps>` has no meaning to it, and a
        // `<div style="...">` layout wrapper has no page to draw its layout
        // in. Its content is already ordinary blocks (a numbered list, a
        // picture, a paragraph), so it draws as plain flow with the wrapper
        // dropped, the same as format.txt says a reader should see it: a
        // list, a picture, a paragraph, not the tag around them.
        Block::Html { children, .. } => blocks(children, depth),
        Block::RawHtml { html } => format!("{html}\n\n"),
    }
}

/// Pictures SideFX wrote on consecutive lines of one paragraph. That shared
/// paragraph is the "these belong side by side" signal: a comparison row, such
/// as one fracture shown as concrete, glass and wood. Markdown has no row, so
/// the row is raw HTML and `rehype-raw` renders it. The figures match heights
/// in the front-end; see `.image-group` in `globals.css`.
fn image_group(text: &[Inline]) -> Option<String> {
    let mut sources = Vec::new();
    for inline in text {
        match inline {
            Inline::Image { src } => sources.push(src),
            Inline::Text { text } if text.trim().is_empty() => {}
            _ => return None,
        }
    }
    if sources.len() < 2 {
        return None;
    }
    let figures: String = sources
        .iter()
        .map(|src| format!("<figure><img src=\"{}\" alt=\"\" /></figure>", attribute(src)))
        .collect();
    Some(format!(
        "<div class=\"not-prose image-group\">{figures}</div>\n\n"
    ))
}

/// One pseudo-HTML element, on one line, with its content inside it.
fn html(tag: &str, attributes: &str, children: &[Block]) -> String {
    let head = match attributes.is_empty() {
        true => tag.to_string(),
        false => format!("{tag} {attributes}"),
    };
    format!("<{head}>{}</{tag}>", cell_html(children, true))
}

/// The `#id:` of a heading or a term, where Houdini's F1 and a `[text|#id]`
/// link land. On a parameter it is the parameter's internal name, which an
/// agent needs too. It goes before the text: after it, the heading's own slug
/// would pick up the trailing space.
///
/// One row can document two parameters (`#id: goal_x, goal_y`), and F1 on
/// either lands on it. Only the first line: a body indented with tabs under
/// `#id:` runs on into the value (`sop/volumewrangle`).
fn anchor(id: &Option<String>) -> String {
    let line = id.as_deref().and_then(|id| id.lines().next()).unwrap_or_default();
    line.split([',', ' ', '\t'])
        .filter(|id| !id.is_empty())
        .map(|id| format!("<span id=\"{}\"></span>", attribute(id)))
        .collect()
}

/// A value going into a double-quoted HTML attribute.
fn attribute(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;")
}

/// `[Icon:TOOLS/handles]` names a picture in `icons.zip`, not a file beside
/// the page. Prose leans on it — "click [Icon:TOOLS/handles] to" — so it is
/// kept, as an `<img>` with no `src` that the front-end's `Image` draws.
fn icon(name: &str, size: IconSize) -> String {
    let size = match size {
        IconSize::Small => "small",
        IconSize::Normal => "normal",
        IconSize::Large => "large",
    };
    format!("<img data-icon=\"{}\" data-size=\"{size}\" alt=\"\">", attribute(name))
}

fn item(name: &str, label: &str, props: &Props, children: &[Block], depth: u8) -> String {
    let body = blocks(children, depth + 1);
    match name {
        // Markdown has no video, and the app renders the raw tag with the same
        // component that draws a picture. `loop` and `autoplay` are the page's
        // own, so a demonstration that repeats keeps repeating here. The
        // `"""caption"""` under it goes in `title`, which `portable` keeps.
        "video" => {
            let src = attribute(prop(props, "src").unwrap_or_default());
            let caption = children.iter().find_map(|block| match block {
                Block::Summary { text } | Block::Paragraph { text } => Some(crate::inline::plain(text)),
                _ => None,
            });
            let title = match caption.as_deref().map(str::trim) {
                Some(caption) if !caption.is_empty() => format!(" title=\"{}\"", attribute(caption)),
                _ => String::new(),
            };
            let flag = |name: &str| match prop(props, name) == Some("true") {
                true => format!(" {name}"),
                false => String::new(),
            };
            let muted = if prop(props, "autoplay") == Some("true") {
                " muted"
            } else {
                ""
            };
            format!(
                "<video src=\"{src}\"{title} controls{}{}{muted}></video>

",
                flag("loop"),
                flag("autoplay")
            )
        }
        // `:vimeo: Set keyframe` with `#id: 116173730`. The front-end draws a
        // box that loads the player only when the reader asks for it.
        "vimeo" => match prop(props, "id") {
            Some(id) => format!(
                "<div class=\"not-prose vimeo\" data-id=\"{}\" title=\"{}\"></div>\n\n",
                attribute(id.trim()),
                attribute(label)
            ),
            None => String::new(),
        },
        // `:load_example:` names an example asset, by `#path` or by
        // `#examplefile`. The front-end draws its Launch button in place.
        "load_example" => {
            let file = prop(props, "path").or_else(|| prop(props, "examplefile")).unwrap_or_default();
            let file = file.trim().trim_start_matches('/');
            let path = file.strip_suffix(".otl").or_else(|| file.strip_suffix(".hda")).unwrap_or(file);
            let head = match label.trim_end_matches(':').trim() {
                "" => String::new(),
                label => format!("**{label}**

"),
            };
            format!(
                "{head}<div class=\"not-prose load-example\" data-path=\"{}\"></div>

{body}",
                attribute(path)
            )
        }
        name if admonition(name).is_some() => {
            let (kind, head) = admonition(name).expect("the name is an admonition");
            // A blockquote that opens with `[!KIND]` is a callout to the
            // front-end. What follows the marker is its title, so a release
            // note keeps the kind of change it announces.
            let title = match (head, label.is_empty()) {
                (None, true) => String::new(),
                (None, false) => format!(" {label}"),
                (Some(head), true) => format!(" {head}"),
                (Some(head), false) => format!(" {head}: {label}"),
            };
            quote(&format!("[!{kind}]{title}\n\n{body}"))
        }
        // Only reached when `:usage:` was not one clean signature — see
        // `clean_signature` in blocks.rs. The label is running text, not a
        // marker to draw as a block.
        "usage" => match label.is_empty() {
            true => body,
            false => format!("{label}\n\n{body}"),
        },
        // `:arg:geohandle:` names one argument of a VEX function. The name is
        // code, the way the reader types it, and the front-end sets it beside
        // its type from the signature.
        "arg" => format!("`{}`\n\n{body}", label.trim_end_matches(':').trim()),
        // `:null:` only carries an `#id:` for an include to point at.
        "null" => body,
        // The label of `:fig:` is the picture itself. In bold it would be
        // `**![](…)**`, which no reader needs.
        "fig" => match label.is_empty() {
            true => body,
            false => format!("{label}\n\n{body}"),
        },
        "col" | "box" | "tab" | "task" | "disclosure" | "bubble" | "caption" => {
            if label.is_empty() {
                body
            } else {
                format!("**{label}**\n\n{body}")
            }
        }
        _ => {
            let head = capitalise(name);
            if label.is_empty() {
                format!("**{head}**\n\n{body}")
            } else {
                format!("**{head}: {label}**\n\n{body}")
            }
        }
    }
}

/// The `@parameters` section, as the two-column table SideFX draws.
///
/// The doc build gives every parameter a `div.parameter.sbs-item`, which is a
/// name in a narrow left column and its help beside it. The markup underneath
/// is a plain definition — `Group:` with an indented body — so rendering the
/// definition as written gives a bold line with a paragraph under it, and a
/// node with twenty parameters becomes a page of forty stacked blocks with no
/// column to read down. The table is what the reader is meant to see.
///
/// A parameter FOLDER is a heading inside the section. It keeps its heading
/// and gets a table of its own, so the folders stay separable.
fn parameters(children: &[Block], depth: u8) -> String {
    let mut out = String::new();
    let mut run: Vec<&Block> = Vec::new();

    let flush = |run: &mut Vec<&Block>, out: &mut String| {
        if run.is_empty() {
            return;
        }
        out.push_str("| Parameter | Description |\n| --- | --- |\n");
        for block in run.drain(..) {
            let Block::Definition { term, id, children, .. } = block else {
                continue;
            };
            out.push_str(&format!(
                "| {}{} | {} |\n",
                anchor(id),
                cell_text(&inlines(term)),
                cell_text(&cell_html(children, false))
            ));
        }
        out.push('\n');
        // Shares its row format with `flush_side_by_side`; kept separate
        // because a parameter table also has to split on a folder heading
        // and a group divider, which no other side-by-side content does.
    };

    for child in children {
        match child {
            Block::Definition { .. } => run.push(child),
            Block::Heading {
                level,
                id,
                title: heading,
                children,
                ..
            } => {
                flush(&mut run, &mut out);
                let level = (*level).clamp(3, 6);
                out.push_str(&format!(
                    "{} {}{}\n\n{}",
                    "#".repeat(level as usize),
                    anchor(id),
                    title(heading),
                    parameters(children, depth)
                ));
            }
            // A divider inside `@parameters` is a parameter group, not a rule.
            // Its label names the group and its children are parameters, so
            // they stay in the table instead of dropping out of it as prose.
            Block::Divider {
                label, children, ..
            } => {
                flush(&mut run, &mut out);
                if let Some(label) = label {
                    out.push_str(&format!("### {}\n\n", inlines(label)));
                }
                out.push_str(&parameters(children, depth));
            }
            other => {
                flush(&mut run, &mut out);
                out.push_str(&one(other, depth));
            }
        }
    }
    flush(&mut run, &mut out);
    out
}

/// A parameter's help, as one line of HTML that can sit in a table cell.
///
/// Markdown has no block inside a cell, so everything a parameter body can
/// hold — paragraphs, the menu of values under it, a small table of attribute
/// names — becomes HTML that `rehype-raw` renders. A nested table stays a
/// table: the HTML parser keeps a `<table>` inside a `<td>`, and a list would
/// lose which value sits in which column.
fn cell_html(blocks: &[Block], raw: bool) -> String {
    let mut out = String::new();
    let gap = |out: &mut String| {
        if !out.is_empty() {
            out.push_str("<br><br>");
        }
    };
    for block in blocks {
        match block {
            Block::Paragraph { text } | Block::Summary { text } => {
                gap(&mut out);
                out.push_str(&text_in(text, raw));
            }
            // The menu of values under a parameter — `Static`, `Animated`.
            Block::Definition { term, id, children, .. } => {
                gap(&mut out);
                out.push_str(&format!(
                    "{}<strong>{}</strong><br>{}",
                    anchor(id),
                    text_in(term, raw),
                    cell_html(children, raw)
                ));
            }
            Block::Bullets { items } | Block::Numbers { items } => {
                let tag = matches!(block, Block::Numbers { .. })
                    .then_some("ol")
                    .unwrap_or("ul");
                let rows: String = items
                    .iter()
                    .map(|item| format!("<li>{}</li>", cell_html(&item.blocks, raw)))
                    .collect();
                out.push_str(&format!("<{tag}>{rows}</{tag}>"));
            }
            Block::Code { text, .. } => {
                out.push_str(&format!("<pre><code>{}</code></pre>", escape(text)));
            }
            Block::Table { rows } => {
                let rows: String = rows
                    .iter()
                    .map(|row| {
                        let cells: String = row
                            .iter()
                            .map(|cell| {
                                let tag = if cell.heading { "th" } else { "td" };
                                format!("<{tag}>{}</{tag}>", cell_html(&cell.blocks, raw))
                            })
                            .collect();
                        format!("<tr>{cells}</tr>")
                    })
                    .collect();
                out.push_str(&format!("<table>{rows}</table>"));
            }
            Block::Html {
                tag,
                attributes,
                children,
            } => out.push_str(&html(tag, attributes, children)),
            // A clip under a parameter: `Flow:` on the Mountain SOP shows the
            // noise moving. It carries its source and its caption.
            Block::Item { name, props, children, .. } if name == "video" || name == "vimeo" => {
                gap(&mut out);
                out.push_str(item(name, "", props, children, 1).trim());
            }
            Block::Item { children, .. } => {
                gap(&mut out);
                out.push_str(&cell_html(children, raw));
            }
            other => {
                gap(&mut out);
                out.push_str(one(other, 1).trim());
            }
        }
    }
    out
}

/// Text inside a table cell, in the notation that cell's reader understands.
///
/// A markdown table cell is parsed as markdown, so ``P`` there becomes a code
/// pill. The content of a RAW HTML element is not parsed as markdown at all,
/// so the same backticks would reach the reader as backticks — that content
/// has to be written as HTML.
fn text_in(text: &[Inline], raw: bool) -> String {
    match raw {
        false => inlines(text),
        true => raw_inlines(text),
    }
}

/// The same inline text as `inlines`, in HTML.
///
/// Not `html::inlines`: that one writes the icons and glyphs the HTML page
/// draws, and the front-end's markdown renderer has no component for them.
/// This writes only what a table cell needs, and drops what `inlines` drops.
fn raw_inlines(text: &[Inline]) -> String {
    let mut out = String::new();
    for (at, inline) in text.iter().enumerate() {
        match inline {
            Inline::Icon { .. } if marks_a_link(text, at) => {}
            Inline::Text { text } => out.push_str(&escape(text)),
            Inline::Raw { text } => out.push_str(text),
            Inline::Bold { body } | Inline::Ui { body } => {
                out.push_str(&format!("<strong>{}</strong>", raw_inlines(body)))
            }
            Inline::Italic { body } => out.push_str(&format!("<em>{}</em>", raw_inlines(body))),
            Inline::Code { text } => out.push_str(&format!("<code>{}</code>", escape(text))),
            Inline::Var { name } => out.push_str(&format!("<code>&lt;{}&gt;</code>", escape(name))),
            Inline::Key { key } => out.push_str(&format!("<code>{}</code>", escape(key))),
            Inline::Glyph { .. } | Inline::Fold { .. } => {}
            Inline::Icon { src, size } => out.push_str(&icon(src, *size)),
            Inline::Image { src } => {
                out.push_str(&format!("<img src=\"{}\" alt=\"\">", attribute(src)))
            }
            Inline::Link { text, target } => out.push_str(&format!(
                "<a href=\"{}\">{}</a>",
                attribute(&url(target)),
                raw_inlines(text)
            )),
        }
    }
    out
}

/// Anything going into a pipe-table cell. A cell is one line, and a bar in it
/// ends the cell.
fn cell_text(body: &str) -> String {
    // A cell is one line, so the hard break under a definition term
    // becomes the `<br>` it stands for before the lines are joined.
    body.replace("\\\n", "<br>")
        .replace('|', "\\|")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn table(rows: &[Vec<crate::model::Cell>], depth: u8) -> String {
    let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if width == 0 {
        return String::new();
    }
    // A table inside a cell has no markdown of its own to fall back on: a
    // pipe table is a run of whole lines, and a cell is one line of one. The
    // parameters table already writes nested content as HTML for the same
    // reason; a nested table takes that route too, instead of running the
    // pipe-table renderer a second time and flattening its own pipes into
    // the cell's text.
    let cell = |cell: &crate::model::Cell| {
        let text = if cell.blocks.iter().any(|b| matches!(b, Block::Table { .. })) {
            cell_html(&cell.blocks, false)
        } else {
            blocks(&cell.blocks, depth + 1)
        };
        cell_text(&text)
    };
    let heading = rows.first().is_some_and(|r| r.iter().all(|c| c.heading));
    if !heading {
        // format.txt's pipe syntax has no way to write a table without a
        // header: the first row is always read back as one. A table with no
        // named columns has to skip that syntax, or it prints a blank band
        // GFM requires but SideFX never draws. HTML has no such requirement.
        return table_html(rows, width);
    }
    let mut out = String::new();
    let mut rows = rows.iter();
    let header: Vec<String> = rows.next().expect("the table has a row").iter().map(cell).collect();
    out.push_str(&format!("| {} |\n", pad(&header, width).join(" | ")));
    out.push_str(&format!("|{}\n", " --- |".repeat(width)));
    for row in rows {
        let cells: Vec<String> = row.iter().map(cell).collect();
        out.push_str(&format!("| {} |\n", pad(&cells, width).join(" | ")));
    }
    out.push('\n');
    out
}

/// A table with no real header row, written as plain HTML so it has no
/// `<thead>` to draw an empty band over. `cell_html` renders each cell's own
/// blocks, the same call the pipe-table path uses for a cell that nests
/// another table.
fn table_html(rows: &[Vec<crate::model::Cell>], width: usize) -> String {
    let mut out = String::from("<table>\n");
    for row in rows {
        out.push_str("<tr>");
        for i in 0..width {
            // Raw, because nothing inside a block of raw HTML is read as
            // markdown: `Shift + T` in backticks would reach the reader with
            // its backticks still on it.
            let html = row.get(i).map(|c| cell_html(&c.blocks, true)).unwrap_or_default();
            out.push_str(&format!("<td>{html}</td>"));
        }
        out.push_str("</tr>\n");
    }
    out.push_str("</table>\n\n");
    out
}

fn pad(cells: &[String], width: usize) -> Vec<String> {
    let mut cells = cells.to_vec();
    cells.resize(width, String::new());
    cells
}

fn list_item(marker: &str, body: &str) -> String {
    let body = body.trim_end();
    // A continuation line belongs to the item only when it is indented past
    // the marker. `-` needs two spaces and `1.` needs three, so two spaces for
    // every marker dropped the rest of a numbered step out of its own list.
    let pad = " ".repeat(marker.chars().count() + 1);
    let mut out = String::new();
    for (i, line) in body.lines().enumerate() {
        if i == 0 {
            out.push_str(&format!("{marker} {line}\n"));
        } else if line.is_empty() {
            out.push('\n');
        } else {
            out.push_str(&format!("{pad}{line}\n"));
        }
    }
    out
}

fn indent(body: &str) -> String {
    let mut out = String::new();
    for line in body.trim_end().lines() {
        if line.is_empty() {
            out.push('\n');
        } else {
            out.push_str(&format!("  {line}\n"));
        }
    }
    out.push('\n');
    out
}

/// The GitHub-style admonition a `:name:` block becomes, and the title written
/// after the marker.
///
/// `remark-callouts` on the front-end reads the marker and draws the coloured
/// surface. It knows five kinds, so a release note is one of those five with a
/// title that says which kind of change it announces.
fn admonition(name: &str) -> Option<(&'static str, Option<&'static str>)> {
    match name {
        "note" => Some(("NOTE", None)),
        // A per-platform note is a note. The platform is its title, which the
        // site drops and this keeps.
        "platform" => Some(("NOTE", None)),
        "tip" => Some(("TIP", None)),
        "warning" => Some(("WARNING", None)),
        "new" => Some(("NOTE", Some("New"))),
        "improved" => Some(("NOTE", Some("Improved"))),
        "changed" => Some(("IMPORTANT", Some("Changed"))),
        "dev" => Some(("NOTE", Some("For developers"))),
        "fixed" => Some(("TIP", Some("Fixed"))),
        "bug" => Some(("CAUTION", Some("Bug"))),
        _ => None,
    }
}

fn quote(body: &str) -> String {
    let mut out = String::new();
    for line in body.trim_end().lines() {
        if line.is_empty() {
            out.push_str(">\n");
        } else {
            out.push_str(&format!("> {line}\n"));
        }
    }
    out.push('\n');
    out
}

fn capitalise(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Whether the icon at `at` stands just before a link to a page in the help.
/// The app draws that page's own icon in front of every such link, so the
/// icon the source writes there would show twice.
fn marks_a_link(inlines: &[Inline], at: usize) -> bool {
    let next = inlines[at + 1..]
        .iter()
        .find(|inline| !matches!(inline, Inline::Text { text } if text.trim().is_empty()));
    matches!(next, Some(Inline::Link { target, .. })
        if !matches!(target, LinkTarget::Web { .. } | LinkTarget::Wikipedia { .. }))
}

pub fn inlines(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for (at, inline) in inlines.iter().enumerate() {
        match inline {
            Inline::Icon { .. } if marks_a_link(inlines, at) => {}
            Inline::Text { text } | Inline::Raw { text } => out.push_str(text),
            Inline::Bold { body } | Inline::Ui { body } => {
                out.push_str(&format!("**{}**", self::inlines(body)))
            }
            Inline::Italic { body } => out.push_str(&format!("_{}_", self::inlines(body))),
            Inline::Code { text } => out.push_str(&format!("`{text}`")),
            Inline::Var { name } => out.push_str(&format!("`<{name}>`")),
            Inline::Key { key } => out.push_str(&format!("`{key}`")),
            Inline::Glyph { .. } | Inline::Fold { .. } => {}
            Inline::Image { src } => out.push_str(&format!("![]({src})")),
            Inline::Icon { src, size } => out.push_str(&icon(src, *size)),
            Inline::Link { text, target } => {
                out.push_str(&format!("[{}]({})", self::inlines(text), url(target)))
            }
        }
    }
    out
}

/// The old particle context `pop` was removed from Houdini, and each of its
/// nodes that lives on is now a DOP named `pop<name>`. Some pages still link
/// to the old path: `Node:pop/location` is `/nodes/dop/poplocation` today.
/// A name with no DOP stays a dead link, as it was.
fn retired(path: String) -> String {
    match path.strip_prefix("/nodes/pop/") {
        Some(name) => format!("/nodes/dop/pop{name}"),
        None => path,
    }
}

/// The path a link points at inside the app.
pub fn url(target: &LinkTarget) -> String {
    match target {
        LinkTarget::Wiki { path, anchor } => match anchor {
            Some(anchor) => format!("{}#{anchor}", retired(path.clone())),
            None => retired(path.clone()),
        },
        LinkTarget::Web { url } => url.clone(),
        // `[Node:/cop/file]` is written with a slash as often as without.
        LinkTarget::Node { path } => retired(format!("/nodes/{}", path.trim_start_matches('/'))),
        LinkTarget::Expression { name } => format!("/expressions/{name}"),
        LinkTarget::Vex { name } => format!("/vex/functions/{name}"),
        LinkTarget::Mantra { name } => format!("/props/mantra#{name}"),
        LinkTarget::Hom { path, member } => match member {
            Some(member) => format!("/hom/{}#{member}", path.replace('.', "/")),
            None => format!("/hom/{}", path.replace('.', "/")),
        },
        LinkTarget::Py { path, member } => match member {
            Some(member) => format!("/hapi/{path}#{member}"),
            None => format!("/hapi/{path}"),
        },
        LinkTarget::HScript { name } => format!("/commands/{name}"),
        LinkTarget::Wikipedia { article } => {
            format!("https://en.wikipedia.org/wiki/{article}")
        }
    }
}

/// The page for a reader outside the app: the copy button, a saved file, an
/// Obsidian note, the `.md` address. The HTML this writer leaves for the app's
/// layout becomes plain Markdown. The column wrappers go and their content
/// stacks. Each `<img>` and `<video>` becomes an embed, a clip with its
/// caption as the alt text: Obsidian plays `![](….webm)` in place, and any
/// other reader sees the file. A Vimeo box becomes a link.
pub fn portable(markdown: &str) -> String {
    let mut out = String::new();
    let mut dropped = false;
    for line in markdown.lines() {
        let body = line.trim();
        let indent = &line[..line.len() - line.trim_start().len()];
        // A wrapper takes the blank line after it along, so no gap doubles.
        if std::mem::take(&mut dropped) && body.is_empty() {
            continue;
        }
        // The Launch box is a control of the app, with nothing to read.
        if matches!(body, "<div class=\"columns\">" | "<div class=\"column\">" | "</div>")
            || body.starts_with("<div class=\"not-prose load-example\"")
        {
            dropped = true;
            continue;
        }
        if body.starts_with("<div class=\"not-prose vimeo\"") {
            if let Some(id) = attribute_value(body, "data-id") {
                let title = attribute_value(body, "title").filter(|t| !t.is_empty()).unwrap_or_else(|| "Video".into());
                out.push_str(&format!("{indent}[{title}](https://vimeo.com/{id})\n"));
            }
            continue;
        }
        if body.starts_with("<div class=\"not-prose image-group\">") {
            let embeds: Vec<String> = sources(body).iter().map(|src| format!("{indent}![]({src})")).collect();
            out.push_str(&embeds.join("\n\n"));
            out.push('\n');
            continue;
        }
        out.push_str(&inline_media(line));
        out.push('\n');
    }
    out
}

/// Every `<img src="…">`, `<video src="…"></video>` and picture row in a
/// line, a table cell's among them, as `![](…)`.
fn inline_media(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    loop {
        let found = [("<img src=\"", ">"), ("<video src=\"", "</video>"), ("<div class=\"not-prose image-group\">", "</div>")]
            .into_iter()
            .filter_map(|(open, close)| Some((rest.find(open)?, close)))
            .min_by_key(|(at, _)| *at);
        let Some((start, close)) = found else { break };
        let Some(len) = rest[start..].find(close).map(|at| at + close.len()) else { break };
        let tag = &rest[start..start + len];
        out.push_str(&rest[..start]);
        let alt = attribute_value(tag, "title").unwrap_or_default().replace(']', r"\]");
        let embeds: Vec<String> = sources(tag).iter().map(|src| format!("![{alt}]({src})")).collect();
        match embeds.is_empty() {
            true => out.push_str(tag),
            false => out.push_str(&embeds.join(" ")),
        }
        rest = &rest[start + len..];
    }
    out.push_str(rest);
    out
}

/// Every `src="…"` value in `html`, in order.
fn sources(html: &str) -> Vec<String> {
    html.match_indices("src=\"")
        .filter_map(|(at, _)| html[at + 5..].split('"').next().map(unescape))
        .collect()
}

/// The value of `name="…"` in one tag, unescaped.
fn attribute_value(tag: &str, name: &str) -> Option<String> {
    let key = format!(" {name}=\"");
    let start = tag.find(&key)? + key.len();
    tag[start..].split('"').next().map(unescape)
}

/// Undoes `attribute`.
fn unescape(text: &str) -> String {
    text.replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_portable_page_carries_its_media_as_embeds() {
        let page = "- Shattering:\n\n  <div class=\"columns\">\n\n  <div class=\"column\">\n\n  ![](attachments/a.jpg)\n\n  </div>\n\n  </div>\n\n\
            <div class=\"not-prose image-group\"><figure><img src=\"attachments/b.jpg\" alt=\"\" /></figure><figure><img src=\"attachments/c.jpg\" alt=\"\" /></figure></div>\n\n\
            <video src=\"attachments/d.mp4\" title=\"Ragdoll &amp; forces\" controls loop></video>\n\n\
            | y | a<br><video src=\"attachments/f.webm\" controls></video> |\n\n\
            | x | <img src=\"attachments/e.jpg\" alt=\"\"> |\n\n\
            | z | <div class=\"not-prose image-group\"><figure><img src=\"attachments/g.jpg\" alt=\"\" /></figure><figure><img src=\"attachments/h.jpg\" alt=\"\" /></figure></div> |\n\n\
            <div class=\"not-prose load-example\" data-path=\"examples/a\"></div>\n\n\
            <div class=\"not-prose vimeo\" data-id=\"204607962\" title=\"Boolean &amp; shatter\"></div>\n";
        let note = portable(page);
        assert!(!note.contains("<div") && !note.contains("<figure") &&!note.contains("</div>") && !note.contains("<img") && !note.contains("<video"));
        assert!(!note.contains("\n\n\n"), "{note}");
        for embed in ["  ![](attachments/a.jpg)", "![](attachments/b.jpg)\n\n![](attachments/c.jpg)", "![Ragdoll & forces](attachments/d.mp4)", "| x | ![](attachments/e.jpg) |", "| y | a<br>![](attachments/f.webm) |", "| z | ![](attachments/g.jpg) ![](attachments/h.jpg) |"] {
            assert!(note.contains(embed), "{embed} in {note}");
        }
        assert!(note.contains("[Boolean & shatter](https://vimeo.com/204607962)"));
    }

    #[test]
    fn a_link_to_the_old_pop_context_goes_to_its_dop() {
        let node = LinkTarget::Node { path: "pop/location".into() };
        assert_eq!(url(&node), "/nodes/dop/poplocation");
        let wiki = LinkTarget::Wiki { path: "/nodes/pop/sprite".into(), anchor: Some("parms".into()) };
        assert_eq!(url(&wiki), "/nodes/dop/popsprite#parms");
        let other = LinkTarget::Node { path: "/sop/box".into() };
        assert_eq!(url(&other), "/nodes/sop/box");
    }

    #[test]
    fn an_icon_before_a_page_link_is_left_to_the_link() {
        let icon = || Inline::Icon { src: "SOP/bulge".into(), size: IconSize::Normal };
        let link = |target| Inline::Link { text: vec![Inline::Text { text: "Bulge".into() }], target };
        let page = inlines(&[icon(), link(LinkTarget::Node { path: "sop/bulge".into() })]);
        assert_eq!(page, "[Bulge](/nodes/sop/bulge)");
        let spaced = inlines(&[icon(), Inline::Text { text: " ".into() }, link(LinkTarget::Node { path: "sop/bulge".into() })]);
        assert!(!spaced.contains("data-icon"), "{spaced}");
        let web = inlines(&[icon(), link(LinkTarget::Web { url: "https://example.com".into() })]);
        assert!(web.contains("data-icon"), "{web}");
        let alone = inlines(&[icon(), Inline::Text { text: " tool".into() }]);
        assert!(alone.contains("data-icon"), "{alone}");
    }
}
