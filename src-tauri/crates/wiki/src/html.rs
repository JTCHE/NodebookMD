//! HTML for the reading view. The front-end styles the class names.

use crate::markdown::url;
use crate::model::{Block, Cell, IconSize, Inline, Page, Props, Title, prop};

pub fn page(page: &Page) -> String {
    let mut out = String::new();
    out.push_str("<h1 class=\"page-title\">");
    out.push_str(&title(&page.title));
    out.push_str("</h1>");
    if let Some(summary) = &page.summary {
        out.push_str(&format!("<p class=\"summary\">{}</p>", inlines(summary)));
    }
    out.push_str(&blocks(&page.blocks));
    out
}

fn title(title: &Title) -> String {
    let mut out = String::new();
    if let Some(pre) = &title.pre {
        out.push_str(&format!("<span class=\"pre\">{}</span>", inlines(pre)));
    }
    out.push_str(&inlines(&title.main));
    if let Some(sub) = &title.sub {
        out.push_str(&format!("<span class=\"sub\">{}</span>", inlines(sub)));
    }
    out
}

pub fn blocks(blocks: &[Block]) -> String {
    blocks.iter().map(one).collect()
}

fn one(block: &Block) -> String {
    match block {
        Block::Heading {
            level,
            id,
            title: heading,
            props,
            children,
        } => {
            let level = (*level).clamp(2, 6);
            let id = id
                .as_ref()
                .map(|id| format!(" id=\"{}\"", escape(id)))
                .unwrap_or_default();
            format!(
                "<section{}{}><h{level}>{}</h{level}>{}</section>",
                id,
                class(props, "section"),
                title(heading),
                blocks(children)
            )
        }
        Block::Section {
            name,
            title: label,
            props,
            children,
        } => {
            let heading = match label {
                Some(label) => inlines(label),
                None => escape(&capitalise(name)),
            };
            format!(
                "<section id=\"{name}\"{}><h2>{heading}</h2>{}</section>",
                class(props, &format!("at-section at-{name}")),
                blocks(children)
            )
        }
        Block::Paragraph { text } => format!("<p>{}</p>", inlines(text)),
        Block::Summary { text } => format!("<p class=\"summary\">{}</p>", inlines(text)),
        Block::Bullets { items } => {
            let body: String = items
                .iter()
                .map(|i| format!("<li>{}</li>", blocks(&i.blocks)))
                .collect();
            format!("<ul>{body}</ul>")
        }
        Block::Numbers { items } => {
            let body: String = items
                .iter()
                .map(|i| format!("<li>{}</li>", blocks(&i.blocks)))
                .collect();
            format!("<ol>{body}</ol>")
        }
        Block::Definition {
            term, id, children, ..
        } => {
            let id = id
                .as_ref()
                .map(|id| format!(" id=\"{}\"", escape(id)))
                .unwrap_or_default();
            format!(
                "<dl{id}><dt>{}</dt><dd>{}</dd></dl>",
                inlines(term),
                blocks(children)
            )
        }
        Block::Item {
            name,
            label,
            props,
            children,
        } => item(name, label, props, children),
        Block::Usage {
            signature,
            children,
        } => format!(
            "<div class=\"usage\"><code>{}</code>{}</div>",
            escape(signature),
            blocks(children)
        ),
        Block::Code { language, text } => {
            let language = language
                .as_ref()
                .map(|l| format!(" class=\"language-{}\"", escape(l)))
                .unwrap_or_default();
            format!("<pre><code{language}>{}</code></pre>", escape(text))
        }
        Block::Divider {
            label,
            invisible,
            children,
            ..
        } => {
            let body = blocks(children);
            if *invisible {
                return body;
            }
            let rule = match label {
                Some(label) => {
                    format!("<div class=\"divider\"><span>{}</span></div>", inlines(label))
                }
                None => "<hr>".to_string(),
            };
            rule + &body
        }
        Block::Table { rows } => table(rows),
        Block::Include {
            path,
            block_id,
            contents_only,
        } => {
            let anchor = block_id.as_deref().unwrap_or_default();
            format!(
                "<div class=\"include\" data-path=\"{}\" data-block=\"{}\" data-contents=\"{}\"></div>",
                escape(path),
                escape(anchor),
                contents_only
            )
        }
        Block::Subtopic { link, children } => format!(
            "<div class=\"subtopic\">{}{}</div>",
            inlines(link),
            blocks(children)
        ),
        Block::Html {
            tag,
            attributes,
            children,
        } => {
            let space = if attributes.is_empty() { "" } else { " " };
            format!("<{tag}{space}{attributes}>{}</{tag}>", blocks(children))
        }
        Block::RawHtml { html } => html.clone(),
    }
}

fn item(name: &str, label: &[Inline], props: &Props, children: &[Block]) -> String {
    let body = blocks(children);
    match name {
        "video" => {
            let src = prop(props, "src").unwrap_or_default();
            let loops = prop(props, "loop").is_some_and(|v| v == "true");
            let autoplay = prop(props, "autoplay").is_some_and(|v| v == "true");
            format!(
                "<video src=\"{}\" controls{}{}></video>",
                escape(src),
                if loops { " loop" } else { "" },
                if autoplay { " autoplay muted" } else { "" }
            )
        }
        "vimeo" => {
            let id = prop(props, "id").unwrap_or_default();
            format!(
                "<div class=\"vimeo\" data-id=\"{}\">{}</div>",
                escape(id),
                inlines(label)
            )
        }
        "compare_images" => format!(
            "<div class=\"compare\" data-image1=\"{}\" data-image2=\"{}\"></div>",
            escape(prop(props, "image1").unwrap_or_default()),
            escape(prop(props, "image2").unwrap_or_default())
        ),
        "chart" | "list" => format!(
            "<div class=\"{name}\">{}</div>",
            props
                .iter()
                .map(|(k, v)| format!("<span data-name=\"{}\">{}</span>", escape(k), escape(v)))
                .collect::<String>()
        ),
        _ => {
            let label = if label.is_empty() {
                String::new()
            } else {
                format!("<div class=\"label\">{}</div>", inlines(label))
            };
            format!(
                "<div{}>{label}{body}</div>",
                class(props, &format!("item {name}"))
            )
        }
    }
}

fn table(rows: &[Vec<Cell>]) -> String {
    let cells: String = rows
        .iter()
        .map(|row| {
            let cells: String = row
                .iter()
                .map(|cell| {
                    let tag = if cell.heading { "th" } else { "td" };
                    format!(
                        "<{tag}{}>{}</{tag}>",
                        class(&cell.props, ""),
                        blocks(&cell.blocks)
                    )
                })
                .collect();
            format!("<tr>{cells}</tr>")
        })
        .collect();
    format!("<table>{cells}</table>")
}

/// `#display:` becomes class names, so the front-end owns the look.
fn class(props: &Props, base: &str) -> String {
    let display = prop(props, "display").unwrap_or_default();
    let glyph = prop(props, "glyph").unwrap_or_default();
    let mut names: Vec<String> = base.split_whitespace().map(str::to_string).collect();
    names.extend(display.split_whitespace().map(|n| n.replace(' ', "-")));
    names.retain(|n| !n.is_empty());
    let glyph = if glyph.is_empty() {
        String::new()
    } else {
        format!(" data-glyph=\"{}\"", escape(glyph))
    };
    if names.is_empty() {
        return glyph;
    }
    format!(" class=\"{}\"{glyph}", escape(&names.join(" ")))
}

pub fn inlines(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            Inline::Text { text } => out.push_str(&escape(text)),
            Inline::Raw { text } => out.push_str(text),
            Inline::Bold { body } => {
                out.push_str(&format!("<strong>{}</strong>", self::inlines(body)))
            }
            Inline::Italic { body } => out.push_str(&format!("<em>{}</em>", self::inlines(body))),
            Inline::Ui { body } => out.push_str(&format!(
                "<span class=\"ui\">{}</span>",
                self::inlines(body)
            )),
            Inline::Code { text } => out.push_str(&format!("<code>{}</code>", escape(text))),
            Inline::Var { name } => out.push_str(&format!("<var>{}</var>", escape(name))),
            Inline::Key { key } => out.push_str(&format!("<kbd>{}</kbd>", escape(key))),
            Inline::Glyph { name } => out.push_str(&format!(
                "<i class=\"glyph\" data-glyph=\"{}\"></i>",
                escape(name)
            )),
            Inline::Fold { name } => out.push_str(&format!(
                "<button class=\"fold\" data-fold=\"{}\"></button>",
                escape(name)
            )),
            Inline::Image { src, .. } => {
                out.push_str(&format!("<img src=\"{}\" alt=\"\">", escape(src)))
            }
            // The icon name is resolved against the Houdini install later.
            Inline::Icon { src, size } => out.push_str(&format!(
                "<span class=\"icon {}\" data-icon=\"{}\"></span>",
                size_class(*size),
                escape(src)
            )),
            Inline::Link { text, target } => out.push_str(&format!(
                "<a href=\"{}\">{}</a>",
                escape(&url(target)),
                self::inlines(text)
            )),
        }
    }
    out
}

fn size_class(size: IconSize) -> &'static str {
    match size {
        IconSize::Small => "small",
        IconSize::Normal => "normal",
        IconSize::Large => "large",
    }
}

fn capitalise(name: &str) -> String {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}
