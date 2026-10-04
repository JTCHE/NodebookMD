//! Block markup. Indentation makes the tree, so the parser works on lines.

use crate::inline;
use crate::model::{Block, Cell, Inline, ListItem, Props, Title};

/// One source line. `indent` is the column the text starts at.
struct Line {
    indent: usize,
    text: String,
}

/// The tab stop the help is written against.
///
/// Most pages indent with four spaces, but a writer's editor put real tabs in
/// some of them, and a tab there stands for eight columns. Reading it as four
/// put the line at a shallower indent than the lines around it, which ended
/// the paragraph — sentences on the Box SOP and in the environment reference
/// stopped mid-clause because of it.
const TAB: usize = 8;

/// Split the source into lines, expand tabs and drop the comments.
fn lines_of(source: &str) -> Vec<Line> {
    let mut out = Vec::new();
    let mut in_code = false;
    let mut in_comment = false;
    // Some pages start with a byte order mark.
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    for raw in source.lines() {
        let mut indent = 0usize;
        let mut rest = raw;
        for c in raw.chars() {
            match c {
                ' ' => indent += 1,
                '\t' => indent += TAB - (indent % TAB),
                _ => break,
            }
            rest = &rest[c.len_utf8()..];
        }
        let text = rest.trim_end();

        if in_comment {
            if text.contains("-->") {
                in_comment = false;
            }
            continue;
        }
        if !in_code {
            if text.starts_with("<!--") {
                if !text.contains("-->") {
                    in_comment = true;
                }
                continue;
            }
            if text.starts_with("//") {
                continue;
            }
            // A line of literal HTML the source embeds for layout — a `<div
            // style="...">` around an image, its matching `</div>` — has no
            // prose of its own and no page to draw the layout in. Dropping
            // the line leaves what it wrapped (an image, a paragraph) as
            // plain flow instead of a tag the reader has to read past. See
            // format.txt, "Embedding HTML", and spec: Local — Raw HTML from
            // the source reaches the reader.
            if is_bare_html_tag(text) {
                continue;
            }
        }
        if text.starts_with("{{{") {
            in_code = true;
        } else if in_code && text.starts_with("}}}") {
            in_code = false;
        }
        out.push(Line {
            indent,
            text: text.to_string(),
        });
    }
    out
}

/// Parse a whole file into the properties and blocks of its top level.
pub fn parse_source(source: &str) -> (Props, Vec<Block>) {
    let lines = lines_of(source);
    parse_container(&lines)
}

/// A line that is nothing but one HTML tag: `<div style="...">`, `</div>`,
/// `<br>`. Real prose does not open or close on its own line like this, so a
/// line matching it carries no text of its own.
fn is_bare_html_tag(text: &str) -> bool {
    let Some(inner) = text
        .strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .map(|s| s.strip_prefix('/').unwrap_or(s))
        .map(|s| s.strip_suffix('/').unwrap_or(s))
    else {
        return false;
    };
    let tag = inner.split_whitespace().next().unwrap_or(inner);
    !tag.is_empty()
        && tag.chars().all(|c| c.is_ascii_alphabetic())
        && !inner.contains(['<', '>'])
}

/// Parse the lines of one container: its own properties, then its blocks.
fn parse_container(lines: &[Line]) -> (Props, Vec<Block>) {
    let base = lines
        .iter()
        .filter(|l| !l.text.is_empty())
        .map(|l| l.indent)
        .min()
        .unwrap_or(0);

    let mut props: Props = Vec::new();
    let mut blocks: Vec<Block> = Vec::new();
    let mut i = 0usize;

    while i < lines.len() {
        if lines[i].text.is_empty() {
            i += 1;
            continue;
        }
        // A line deeper than the container base with nothing to hang under.
        // Parse the whole run as its own group so no content is lost.
        if lines[i].indent > base {
            let end = run_end(lines, i, base);
            let (_, nested) = parse_container(&lines[i..end]);
            blocks.extend(nested);
            i = end;
            continue;
        }
        let start = i;
        let indent = lines[i].indent;
        let text = lines[i].text.clone();

        // Blocks that read more than one line of their own.
        if text.starts_with("{{{") {
            let (block, next) = code_block(lines, start);
            blocks.push(block);
            i = next;
            continue;
        }
        if text.starts_with("\"\"\"") {
            let (block, next) = summary_block(lines, start);
            blocks.push(block);
            i = next;
            continue;
        }
        if let Some((name, value_start)) = property_name(&text) {
            let end = run_end(lines, start + 1, indent);
            let value = property_value(&text[value_start..], &lines[start + 1..end]);
            props.push((name, value));
            i = end;
            continue;
        }

        // Everything else owns its line, the lines it wraps on to, and the
        // lines indented under it.
        // A heading, an `@section` and a divider each own their line and
        // nothing more. The help does not always leave a blank line under
        // one, and without this the paragraph below is read as the rest of
        // the heading — which takes the section, its title and its body out
        // of the page together.
        let one_line = matches!(
            starts_block(&text),
            Some(Kind::Heading | Kind::Section | Kind::Divider)
        );
        let mut head = text.clone();
        let mut wrapped = start + 1;
        while !one_line
            && wrapped < lines.len()
            && lines[wrapped].indent == indent
            && !lines[wrapped].text.is_empty()
            && starts_block_at(lines, wrapped).is_none()
        {
            head.push(' ');
            head.push_str(&lines[wrapped].text);
            wrapped += 1;
        }
        let text = head;
        let start = wrapped - 1;
        let end = run_end(lines, start + 1, indent);
        let children_lines = &lines[start + 1..end];
        let has_children = children_lines.iter().any(|l| !l.text.is_empty());

        if let Some(block) = single_line_block(&text, children_lines, has_children) {
            blocks.push(block);
            i = end;
            continue;
        }

        // The wrapped lines already hold the whole paragraph. Any lines
        // indented under it are read as their own group on the next turn.
        blocks.push(Block::Paragraph {
            text: inline::parse(&text),
        });
        i = wrapped;
    }

    (props, group(blocks))
}

/// What the line at `at` starts, with the following lines taken into account.
/// A trailing colon only makes a definition when an indented body follows.
fn starts_block_at(lines: &[Line], at: usize) -> Option<Kind> {
    let kind = starts_block(&lines[at].text)?;
    if !matches!(kind, Kind::Definition) {
        return Some(kind);
    }
    lines[at + 1..]
        .iter()
        .find(|line| !line.text.is_empty())
        .filter(|line| line.indent > lines[at].indent)
        .map(|_| kind)
}

/// The end of the run of lines that belong under the line at `start - 1`.
fn run_end(lines: &[Line], start: usize, indent: usize) -> usize {
    let mut end = start;
    let mut last_content = start;
    while end < lines.len() {
        if lines[end].text.is_empty() {
            end += 1;
            continue;
        }
        if lines[end].indent <= indent {
            break;
        }
        end += 1;
        last_content = end;
    }
    last_content.max(start)
}

/// One row of the simple pipe-table markup: `text` is one cell's own line,
/// ending in `|` or `||`; `children` is what is indented under it.
///
/// format.txt, "Simple tables": "Indented cells appear next to the parent."
/// The first line indented under a cell (skipping this cell's own `#prop:`
/// lines) always starts the NEXT cell of the row, whether or not that line
/// itself ends in a pipe — confirmed against the real doc build: the Camera
/// LOP page chains a bare shortcut cell into a third, description cell with
/// no pipe of its own. A pipe on that next line means the chain keeps going
/// one indent level deeper; no pipe means it is the LAST cell of the row, and
/// format.txt allows only that one "to have multiple paragraphs" — every
/// sibling line left after it folds into its body, not into a further cell.
fn cell_row(text: &str, children: &[Line]) -> Vec<Cell> {
    let heading = text.ends_with("||");
    let body = text.trim_end_matches('|').trim();

    let next = children
        .iter()
        .position(|l| !l.text.is_empty() && property_name(&l.text).is_none());
    let Some(next) = next else {
        return vec![fold_cell(heading, body, children)];
    };

    let mut row = vec![fold_cell(heading, body, &children[..next])];
    if children[next].text.ends_with('|') {
        let indent = children[next].indent;
        let end = run_end(children, next + 1, indent);
        row.extend(cell_row(&children[next].text, &children[next + 1..end]));
    } else {
        row.push(fold_cell(false, &children[next].text, &children[next + 1..]));
    }
    row
}

/// One cell's own line, plus whatever is folded into it: this cell's
/// `#prop:` lines, or — for the last cell of a row, per `cell_row` — every
/// paragraph left under it.
fn fold_cell(heading: bool, body: &str, extra: &[Line]) -> Cell {
    let mut lines: Vec<Line> = Vec::new();
    if !body.is_empty() {
        lines.push(Line {
            indent: 0,
            text: body.to_string(),
        });
    }
    let extra_indent = if lines.is_empty() { 0 } else { TAB };
    lines.extend(extra.iter().map(|l| Line {
        indent: l.indent + extra_indent,
        text: l.text.clone(),
    }));
    let (props, blocks) = parse_container(&lines);
    Cell {
        heading,
        blocks,
        props,
    }
}

/// Turns the `Html` blocks that `table>>` / `tr>>` / `th>>` / `td>>` parse
/// into — each already carrying its own children, from the same recursive
/// descent every pseudo-HTML tag goes through — into a `Block::Table`, the
/// same shape `cell_row` builds from the `|`-terminated markup. `None` if
/// what is under `table>>` is not, in fact, a clean grid of rows and cells:
/// a table row wrapping something else stays a plain `Html` block rather
/// than a table with a hole in it.
///
/// A bare `th>>` or `td>>` sitting directly under `table>>`, outside any
/// `tr>>`, is dropped rather than treated as a broken row: the intermediate
/// dynamics reference sets column widths this way — three empty `th
/// width="33%">>` lines before the real rows — and a width with nothing
/// else to say has nowhere to go in a markdown table regardless.
fn table_of(children: &[Block]) -> Option<Block> {
    let mut rows = Vec::with_capacity(children.len());
    for row in children {
        let Block::Html {
            tag,
            children: cells,
            ..
        } = row
        else {
            return None;
        };
        if tag == "th" || tag == "td" {
            continue;
        }
        if tag != "tr" {
            return None;
        }
        let mut cell_row = Vec::with_capacity(cells.len());
        for cell in cells {
            let Block::Html {
                tag,
                children: body,
                ..
            } = cell
            else {
                return None;
            };
            let heading = match tag.as_str() {
                "th" => true,
                "td" => false,
                _ => return None,
            };
            cell_row.push(Cell {
                heading,
                blocks: body.clone(),
                props: Vec::new(),
            });
        }
        rows.push(cell_row);
    }
    (!rows.is_empty()).then_some(Block::Table { rows })
}

fn code_block(lines: &[Line], start: usize) -> (Block, usize) {
    let indent = lines[start].indent;
    let first = lines[start].text.trim_start_matches('{').trim().to_string();
    let mut body: Vec<String> = Vec::new();
    let mut language = None;
    if !first.is_empty() {
        body.push(first);
    }
    let mut i = start + 1;
    let mut raw: Vec<(usize, &str)> = Vec::new();
    while i < lines.len() {
        if lines[i].text.starts_with("}}}") && lines[i].indent <= indent.max(1) {
            i += 1;
            break;
        }
        raw.push((lines[i].indent, lines[i].text.as_str()));
        i += 1;
    }
    // The body keeps its own shape, so dedent by its own left edge.
    let left = raw
        .iter()
        .filter(|(_, text)| !text.is_empty())
        .map(|(indent, _)| *indent)
        .min()
        .unwrap_or(0);
    body.extend(
        raw.iter()
            .map(|(indent, text)| format!("{}{text}", " ".repeat(indent.saturating_sub(left)))),
    );
    if let Some(first) = body.first()
        && let Some(name) = first.strip_prefix("#!")
    {
        language = Some(name.trim().to_string());
        body.remove(0);
    }
    while body.first().is_some_and(|l| l.trim().is_empty()) {
        body.remove(0);
    }
    while body.last().is_some_and(|l| l.trim().is_empty()) {
        body.pop();
    }
    (
        Block::Code {
            language,
            text: body.join("\n"),
        },
        i,
    )
}

fn summary_block(lines: &[Line], start: usize) -> (Block, usize) {
    let mut text = lines[start].text[3..].to_string();
    let mut i = start;
    if let Some(end) = text.find("\"\"\"") {
        text.truncate(end);
        i += 1;
    } else {
        i += 1;
        while i < lines.len() {
            match lines[i].text.find("\"\"\"") {
                Some(end) => {
                    text.push(' ');
                    text.push_str(&lines[i].text[..end]);
                    i += 1;
                    break;
                }
                None => {
                    text.push(' ');
                    text.push_str(&lines[i].text);
                    i += 1;
                }
            }
        }
    }
    (
        Block::Summary {
            text: inline::parse(text.trim()),
        },
        i,
    )
}

/// `#name: value`, and the multi-line form where the value is indented.
fn property_name(text: &str) -> Option<(String, usize)> {
    let rest = text.strip_prefix('#')?;
    let end = rest.find(':')?;
    let name = &rest[..end];
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((name.to_ascii_lowercase(), 1 + end + 1))
}

fn property_value(first: &str, rest: &[Line]) -> String {
    let mut value = first.trim().to_string();
    let indent = rest
        .iter()
        .filter(|l| !l.text.is_empty())
        .map(|l| l.indent)
        .min()
        .unwrap_or(0);
    for line in rest {
        if line.text.is_empty() {
            value.push('\n');
            continue;
        }
        if !value.is_empty() && !value.ends_with('\n') {
            value.push('\n');
        }
        value.push_str(&" ".repeat(line.indent - indent));
        value.push_str(&line.text);
    }
    value.trim().to_string()
}

/// What kind of block a line starts. `None` means a paragraph line.
fn starts_block(text: &str) -> Option<Kind> {
    if text.starts_with("{{{") {
        return Some(Kind::Code);
    }
    if text.starts_with("\"\"\"") {
        return Some(Kind::Summary);
    }
    if property_name(text).is_some() {
        return Some(Kind::Property);
    }
    if heading_parts(text).is_some() {
        return Some(Kind::Heading);
    }
    if text.starts_with('@') && text[1..].starts_with(|c: char| c.is_ascii_alphabetic()) {
        return Some(Kind::Section);
    }
    if text.starts_with("~~") {
        return Some(Kind::Divider);
    }
    if text.starts_with("::") {
        return Some(Kind::Subtopic);
    }
    if text.starts_with(':') && item_parts(text).is_some() {
        return Some(Kind::Item);
    }
    if matches!(text, "TIP:" | "NOTE:" | "WARNING:") {
        return Some(Kind::Item);
    }
    if text.starts_with("* ") || text == "*" {
        return Some(Kind::Bullet);
    }
    // A dash bullet. The help writes most lists with `*`, but a `-` list is
    // legal and used — `@related` on many node pages is one. Without this the
    // dash lines are not the start of anything, so the line above them eats
    // them as the text it wraps on to, and a whole related list ends up
    // inside a section heading.
    if text.starts_with("- ") || text == "-" {
        return Some(Kind::Bullet);
    }
    if text.starts_with("# ") {
        return Some(Kind::Number);
    }
    if text.ends_with('|') {
        return Some(Kind::Cell);
    }
    if html_parts(text).is_some() {
        return Some(Kind::Html);
    }
    if text.ends_with(':') {
        return Some(Kind::Definition);
    }
    None
}

/// A pseudo-HTML line, as `(tag, attributes, the content on the tag's own
/// line)`.
///
/// `format.txt`, "Pseudo HTML", allows the element's content to sit after the
/// `>>` as well as indented under it, and the help uses both — a table row
/// writes `td>> Charlie`. Matching only on a trailing `>>` left that content
/// as prose, so a parameter body with a small table in it reached the reader
/// as the words `td>>` repeated down the page.
fn html_parts(text: &str) -> Option<(&str, &str, &str)> {
    let (head, rest) = text.split_once(">>")?;
    let head = head.trim();
    let (tag, attributes) = match head.split_once(char::is_whitespace) {
        Some((tag, attributes)) => (tag, attributes.trim()),
        None => (head, ""),
    };
    // An element tag, and nothing else. A sentence can hold `>>` too — the
    // format page itself writes ``Parameter: <<id>>`` — so everything before
    // the marker has to look like a tag before this claims the line.
    let named = !tag.is_empty()
        && tag.len() <= 12
        && tag.starts_with(|c: char| c.is_ascii_lowercase())
        && tag.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let attributed = attributes.is_empty()
        || attribute_tokens(attributes).all(|part| part.contains('=') && !part.contains('`'));
    if !named || !attributed {
        return None;
    }
    Some((tag, attributes, rest.trim()))
}

/// Splits an attribute string on whitespace, except inside a `"..."` value —
/// `style="margin-left: 2em"` is one token, not two. A naive
/// `split_whitespace` cut a quoted value with a space in half, so its second
/// half had no `=` and the whole tag was rejected, not just the attribute.
fn attribute_tokens(attributes: &str) -> impl Iterator<Item = &str> {
    let mut tokens = Vec::new();
    let mut start = None;
    let mut quoted = false;
    for (i, c) in attributes.char_indices() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => {
                if let Some(from) = start.take() {
                    tokens.push(&attributes[from..i]);
                }
                continue;
            }
            _ => {}
        }
        start.get_or_insert(i);
    }
    if let Some(from) = start {
        tokens.push(&attributes[from..]);
    }
    tokens.into_iter()
}

enum Kind {
    Code,
    Summary,
    Property,
    Heading,
    Section,
    Divider,
    Subtopic,
    Item,
    Bullet,
    Number,
    Cell,
    Html,
    Definition,
}

/// Build the block for a line that owns exactly one line of markup.
fn single_line_block(text: &str, children: &[Line], has_children: bool) -> Option<Block> {
    let kind = starts_block(text)?;
    let child = |lines: &[Line]| parse_container(lines);

    let block = match kind {
        Kind::Code | Kind::Summary | Kind::Property => return None,
        Kind::Heading => {
            let (level, body, id) = heading_parts(text)?;
            let (props, children) = child(children);
            let id = id.or_else(|| {
                props
                    .iter()
                    .find(|(k, _)| k == "id")
                    .map(|(_, v)| v.clone())
            });
            Block::Heading {
                level,
                id,
                title: title_of(&body),
                props,
                children,
            }
        }
        Kind::Section => {
            let body = &text[1..];
            let (name, title) = match body.split_once(char::is_whitespace) {
                Some((name, title)) => (name, title.trim()),
                None => (body, ""),
            };
            let (props, children) = child(children);
            Block::Section {
                name: name.to_ascii_lowercase(),
                title: (!title.is_empty()).then(|| inline::parse(title)),
                props,
                children,
            }
        }
        Kind::Divider => {
            let invisible = text.starts_with("~~") && !text.starts_with("~~~");
            let label = text.trim_matches('~').trim();
            let (props, children) = child(children);
            Block::Divider {
                label: (!label.is_empty()).then(|| inline::parse(label)),
                invisible,
                props,
                children,
            }
        }
        Kind::Subtopic => {
            let body = text[2..].trim();
            // `::Name:` documents one item of the section it sits in. So does
            // `::Name` with a body under it. Only a link is a subtopic.
            let term = body.strip_suffix(':').unwrap_or(body);
            if !term.starts_with('[') {
                let (props, children) = child(children);
                return Some(definition(term, props, children));
            }
            let (_, children) = child(children);
            Block::Subtopic {
                link: inline::parse(body),
                children,
            }
        }
        Kind::Item => {
            let (name, label) = item_parts(text)?;
            if name == "include" {
                return Some(include_block(&label));
            }
            // `:includeprop vm_phantom:` names a render property by its
            // `#hprop:`, not by a page. `include::resolve` finds the page.
            if name == "includeprop" {
                return Some(Block::Include {
                    path: crate::include::PROPS.to_string(),
                    block_id: Some(label.trim().to_string()),
                    contents_only: false,
                });
            }
            let (props, children) = child(children);
            if name == "usage" {
                let text = label.trim();
                return Some(match clean_signature(text) {
                    Some(signature) => Block::Usage { signature, children },
                    // A few HOM pages write a call and its return type
                    // instead of a signature — `` `f()` -> Type `` — which is
                    // running text with a code span in it, not a signature
                    // to draw as a block.
                    None => Block::Item {
                        name,
                        label: inline::parse(text),
                        props,
                        children,
                    },
                });
            }
            Block::Item {
                name,
                label: inline::parse(label.trim()),
                props,
                children,
            }
        }
        Kind::Bullet | Kind::Number => {
            let body = text[1..].trim();
            let mut lines: Vec<Line> = Vec::new();
            if !body.is_empty() {
                lines.push(Line {
                    indent: 0,
                    text: body.to_string(),
                });
            }
            // The help wraps a long item under its own text, one column past
            // the marker. Those lines are the rest of the sentence, not a
            // block below it, so they have to reach `parse_container` at the
            // same indent as the body — pushing them a tab deeper made every
            // wrapped step two paragraphs, and the second fell out of the list.
            let base = children
                .iter()
                .filter(|l| !l.text.is_empty())
                .map(|l| l.indent)
                .min()
                .unwrap_or(0);
            lines.extend(children.iter().map(|l| Line {
                indent: l.indent.saturating_sub(base),
                text: l.text.clone(),
            }));
            let (props, blocks) = parse_container(&lines);
            let item = ListItem { blocks, props };
            if matches!(kind, Kind::Bullet) {
                Block::Bullets { items: vec![item] }
            } else {
                Block::Numbers { items: vec![item] }
            }
        }
        Kind::Cell => Block::Table {
            rows: vec![cell_row(text, children)],
        },
        Kind::Html => {
            let (tag, attributes, inline_text) = html_parts(text)?;
            let (_, mut children) = child(children);
            // Content on the tag's own line comes before anything indented
            // under it, which is the order it is written in.
            if !inline_text.is_empty() {
                children.insert(
                    0,
                    Block::Paragraph {
                        text: inline::parse(inline_text),
                    },
                );
            }
            // SideFX also writes a table as pseudo-HTML — `table>>`, `tr>>`,
            // `th>>` / `td>>` — instead of the `|`-terminated cell markup
            // `cell_row` builds a `Block::Table` from. It is the same shape,
            // just a different spelling, so it has to reach the reader the
            // same way. Left as a generic `Html` block it does not: both
            // renderers unwrap a tag they do not recognise down to its plain
            // children (`format.txt` says a reader should see the content,
            // not the wrapper), which is right for a layout tag like `<div>`
            // but throws the table's own rows and columns away with it —
            // every cell reaches the reader as its own unrelated paragraph.
            // See spec: Local — Bad table scrape.
            if tag == "table"
                && let Some(table) = table_of(&children)
            {
                return Some(table);
            }
            Block::Html {
                tag: tag.to_string(),
                attributes: attributes.to_string(),
                children,
            }
        }
        Kind::Definition => {
            // A trailing colon only starts a definition when a body follows.
            if !has_children {
                return None;
            }
            let term = &text[..text.len() - 1];
            let (props, children) = child(children);
            definition(term, props, children)
        }
    };
    Some(block)
}

/// A `:usage:` signature is one run of backticks: `` `float noise(float pos)` ``.
/// The reader has to replace the parts written as `<name>` or `<<name>>` —
/// format.txt, "Styles" — so those markers are not part of the signature
/// either. `None` means the label is not one clean span of backticks, so it
/// is not a signature at all.
fn clean_signature(text: &str) -> Option<String> {
    let inner = text.strip_prefix('`')?.strip_suffix('`')?;
    // A HOM page often writes the call and its return type as two spans,
    // `` `f()` -> `Type` ``. Stripping only the outer pair would leave the
    // inner backticks in the signature, so a second span means this is
    // running text, not one signature.
    if inner.contains('`') {
        return None;
    }
    Some(inner.replace(['<', '>'], ""))
}

fn definition(term: &str, props: Props, children: Vec<Block>) -> Block {
    let id = props
        .iter()
        .find(|(k, _)| k == "id")
        .map(|(_, v)| v.clone())
        .or_else(|| method_name(term));
    Block::Definition {
        term: inline::parse(term.trim()),
        id,
        props,
        children,
    }
}

/// `` `inputNames(self)` -> tuple of `str` `` documents a method, and a link
/// to it is written `hou.Node#inputNames`. The term has no `#id:`, so the
/// method's name is its id.
fn method_name(term: &str) -> Option<String> {
    let call = term.trim().trim_start_matches(':').trim_start().strip_prefix('`')?;
    let (name, _) = call.split_once('(')?;
    let plain = !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    plain.then(|| name.to_string())
}

fn include_block(label: &str) -> Block {
    // The Karma settings pages quote the target, because their IDs hold
    // colons: `:include "/nodes/lop/rendersettings#karma:global:samples":`.
    let mut target = label.trim().trim_matches('"');
    let mut contents_only = false;
    if let Some(rest) = target.strip_suffix('/') {
        contents_only = true;
        target = rest;
    }
    let (path, block_id) = match target.split_once('#') {
        Some((path, id)) => (path.to_string(), Some(id.to_string())),
        None => (target.to_string(), None),
    };
    Block::Include {
        path,
        block_id,
        contents_only,
    }
}

/// `:name: label`, `:name:label`, and the capitalised `TIP:` forms.
fn item_parts(text: &str) -> Option<(String, String)> {
    if let Some(name) = match text {
        "TIP:" => Some("tip"),
        "NOTE:" => Some("note"),
        "WARNING:" => Some("warning"),
        _ => None,
    } {
        return Some((name.to_string(), String::new()));
    }
    // `:include path:` puts the whole rest of the line in the label.
    if let Some(body) = text
        .strip_prefix(":include")
        .and_then(|rest| rest.strip_suffix(':'))
        && body.starts_with(char::is_whitespace)
    {
        return Some(("include".to_string(), body.trim().to_string()));
    }
    if let Some(body) = text
        .strip_prefix(":includeprop")
        .and_then(|rest| rest.strip_suffix(':'))
        && body.starts_with(char::is_whitespace)
    {
        return Some(("includeprop".to_string(), body.trim().to_string()));
    }
    let rest = text.strip_prefix(':')?;
    let end = rest.find(':')?;
    let name = &rest[..end];
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some((
        name.to_ascii_lowercase(),
        rest[end + 1..].trim().to_string(),
    ))
}

/// `== Heading == (id)` gives the level, the title text and the ID.
fn heading_parts(text: &str) -> Option<(u8, String, Option<String>)> {
    if !text.starts_with('=') {
        return None;
    }
    let level = text.chars().take_while(|c| *c == '=').count();
    let mut body = text[level..].trim_end();
    let mut id = None;
    if body.ends_with(')')
        && let Some(open) = body.rfind('(')
    {
        let candidate = &body[open + 1..body.len() - 1];
        let head = body[..open].trim_end();
        if head.ends_with('=')
            && !candidate.is_empty()
            && candidate
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            id = Some(candidate.to_string());
            body = head;
        }
    }
    // The closing run decides how much of `body` is title, not the level —
    // that comes from the leading run alone. A source typo can leave the two
    // counts unequal (`= Using Refine == (includeme)`, `== Examples ===`);
    // still a heading, just not a perfectly balanced one, so only a missing
    // closing run at all rejects the line.
    let closing = body.chars().rev().take_while(|c| *c == '=').count();
    if closing == 0 {
        return None;
    }
    let title = body[..body.len() - closing].trim();
    Some((level as u8, title.to_string(), id))
}

/// `pre |> main <| sub`
fn title_of(text: &str) -> Title {
    let (pre, rest) = match text.split_once("|>") {
        Some((pre, rest)) => (Some(inline::parse(pre.trim())), rest),
        None => (None, text),
    };
    let (main, sub) = match rest.split_once("<|") {
        Some((main, sub)) => (main, Some(inline::parse(sub.trim()))),
        None => (rest, None),
    };
    Title {
        pre,
        main: inline::parse(main.trim()),
        sub,
    }
}

/// Join the runs the line parser had to emit one at a time: list items into
/// one list, table cells into rows and a table, then fold headings.
fn group(blocks: Vec<Block>) -> Vec<Block> {
    let mut joined: Vec<Block> = Vec::new();
    for block in blocks {
        match (joined.last_mut(), block) {
            (Some(Block::Bullets { items }), Block::Bullets { items: more }) => items.extend(more),
            (Some(Block::Numbers { items }), Block::Numbers { items: more }) => items.extend(more),
            (Some(Block::Table { rows }), Block::Table { rows: more }) => {
                // A cell with no indented cell beside it starts a new row.
                for row in more {
                    match rows.last_mut() {
                        Some(last)
                            if last.len() < 2 && row.len() == 1 && cells_pair(last, &row) =>
                        {
                            last.extend(row)
                        }
                        _ => rows.push(row),
                    }
                }
            }
            (_, block) => joined.push(block),
        }
    }
    fold_headings(joined)
}

/// A row keeps growing while the cells came from the same run. The line
/// parser already nested the indented cells, so every row arrives with one
/// cell; a heading cell only pairs with another heading cell.
fn cells_pair(row: &[Cell], next: &[Cell]) -> bool {
    row.last().map(|c| c.heading) == next.first().map(|c| c.heading)
}

/// Blocks after a heading belong to it, without being indented under it.
fn fold_headings(blocks: Vec<Block>) -> Vec<Block> {
    let mut out: Vec<Block> = Vec::new();
    let mut stack: Vec<(u8, Block)> = Vec::new();

    fn close(level: u8, stack: &mut Vec<(u8, Block)>, out: &mut Vec<Block>) {
        while stack.last().is_some_and(|(l, _)| *l >= level) {
            let (_, block) = stack.pop().expect("the stack is not empty");
            match stack.last_mut() {
                Some((_, parent)) => children_of(parent).push(block),
                None => out.push(block),
            }
        }
    }

    for block in blocks {
        let level = match &block {
            Block::Heading { level, .. } => Some(*level),
            Block::Section { .. } => Some(1),
            _ => None,
        };
        // A heading written with its body indented under it owns that body
        // and no more. `shelf/box` has `== Placing == (placing)`, an indented
        // body, then a line at the margin: the include of `#placing` in the
        // Box node page must not carry that line, which the node page writes
        // again.
        let indented = matches!(&block, Block::Heading { children, .. } if !children.is_empty());
        match level {
            Some(level) if indented => {
                close(level, &mut stack, &mut out);
                match stack.last_mut() {
                    Some((_, parent)) => children_of(parent).push(block),
                    None => out.push(block),
                }
            }
            Some(level) => {
                close(level, &mut stack, &mut out);
                stack.push((level, block));
            }
            None => match stack.last_mut() {
                Some((_, parent)) => children_of(parent).push(block),
                None => out.push(block),
            },
        }
    }
    close(0, &mut stack, &mut out);
    out
}

fn children_of(block: &mut Block) -> &mut Vec<Block> {
    match block {
        Block::Heading { children, .. } | Block::Section { children, .. } => children,
        _ => unreachable!("only headings and sections hold folded blocks"),
    }
}

/// The page title line, if the file starts with one.
pub fn take_title(blocks: &mut Vec<Block>) -> Option<(Title, Vec<Block>)> {
    // About 150 pages put the summary, a `:warning:` or an include above the
    // title line. What sits above it stays in the body, in front.
    let at = blocks.iter().position(|block| {
        !matches!(block, Block::Summary { .. } | Block::Item { .. } | Block::Include { .. })
    })?;
    let Block::Heading { level: 1, .. } = blocks[at] else {
        return None;
    };
    let Block::Heading {
        title, children, ..
    } = blocks.remove(at)
    else {
        unreachable!("the block is a level one heading");
    };
    let mut body: Vec<Block> = blocks.drain(..at).collect();
    body.extend(children);
    Some((title, body))
}

pub fn text_of(inlines: &[Inline]) -> String {
    inline::plain(inlines)
}


#[cfg(test)]
mod tests {
    /// A link to `hou.Node#inputNames` lands on the method.
    #[test]
    fn a_method_is_its_own_anchor() {
        let source = "@methods\n\n::`inputNames(self)` -> tuple of `str`:\n    Returns the names.\n\n::`__len__(self)` -> `int`:\n    Returns 3.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("<span id=\"inputNames\"></span>"), "{out}");
        assert!(out.contains("<span id=\"__len__\"></span>"), "{out}");
    }

    /// SideFX writes some tables as pseudo-HTML — `table>>`, `tr>>`, `th>>` /
    /// `td>>` — rather than the `|`-terminated cell markup. Checked against
    /// the real doc build: the VEX "Noise and randomness" page draws its
    /// noise-cost table this way, and it reached the reader as six unrelated
    /// paragraphs (one per header and cell) with no row or column left
    /// between them. See spec: Local — Bad table scrape.
    #[test]
    fn pseudo_html_table_tags_become_a_real_table() {
        let source = "table>>\n    tr>>\n        th>> Fruit\n        th>> Price\n    tr>>\n        td>>\n            Apple\n        td>> 1.0\n    tr>>\n        td>>\n            Banana\n        td>> 1.8\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(
            out.contains("| Fruit | Price |") || out.contains("<th>Fruit</th><th>Price</th>"),
            "{out}"
        );
        assert!(out.contains("Apple"), "{out}");
        assert!(out.contains("1.0"), "{out}");
        assert!(out.contains("Banana"), "{out}");
        assert!(out.contains("1.8"), "{out}");
        // Not the flattened-paragraph shape the bug produced: a stray closing
        // tag or the header and its cell running together with no row break.
        assert!(!out.contains("Fruit\n\nPrice"), "{out}");
    }

    /// A `th>>` or `td>>` sitting bare under `table>>`, outside any `tr>>` —
    /// the dynamics reference sets column widths this way, three empty `th
    /// width="..">>` lines before the real rows — must not make the whole
    /// table fall back to flattened paragraphs; it is dropped and the real
    /// rows still become a table.
    #[test]
    fn a_bare_header_cell_outside_a_row_does_not_break_the_table() {
        let source = "table width=\"100%\">>\n    th width=\"33%\">>\n    th width=\"33%\">>\n\n    tr>>\n        td>> Alpha\n        td>> Bravo\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        // No `th>>` row survives as a real header (the bare ones outside any
        // `tr>>` are dropped), so this has no column names and renders as an
        // HTML table rather than a pipe table with a blank header band —
        // same rule the pipe-syntax tables follow. Either way it is still a
        // real table, not the flattened paragraphs the bug produced.
        assert!(out.contains("<td>Alpha</td><td>Bravo</td>"), "{out}");
    }

    /// A pseudo-HTML tag the page does not use for a table — a genuine
    /// wrapper such as `<steps>` — keeps the old behaviour: it draws as its
    /// own plain content, wrapper dropped, not forced into a table shape.
    #[test]
    fn a_non_table_pseudo_html_tag_still_unwraps_to_plain_content() {
        let source = "steps>>\n    * First.\n    * Second.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("First."), "{out}");
        assert!(out.contains("Second."), "{out}");
        assert!(!out.contains('|'), "{out}");
    }

    /// `tr>>` rows that do not hold a clean grid of `th>>` / `td>>` cells —
    /// this one wraps a bullet list instead of a cell — are not forced into
    /// a table with a hole in it; they keep unwrapping the old way.
    #[test]
    fn a_table_tag_around_something_else_is_left_alone() {
        let source = "table>>\n    * Not a row at all.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("Not a row at all."), "{out}");
        assert!(!out.contains("<table>") && !out.contains(" | "), "{out}");
    }

    /// A `~~~ Group ~~~` divider owns what is indented under it. The Bullet
    /// constraint pages put 36 of their 37 parameters there.
    #[test]
    fn a_divider_keeps_what_is_under_it() {
        let source = "~~~ Rotation Limits ~~~\n\n    Max Twist:\n        #id: max_twist\n        The maximum twist.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("Rotation Limits"), "{out}");
        assert!(out.contains("The maximum twist."), "{out}");
    }

    /// format.txt, "Simple tables": a cell line chains into the next cell
    /// through indentation, pipe or no pipe on the child. Checked against the
    /// real doc build: the SideFX page for this exact example renders two
    /// cells, the second holding both paragraphs.
    #[test]
    fn a_cell_chains_into_the_next_even_without_a_pipe() {
        let source = "First cell |\n    Second cell\n\n    Second paragraph in second cell.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        // No `||` line, so no real header: this table has no column names to
        // lose, and renders as HTML instead of a pipe table with a blank band.
        assert!(
            out.contains("<td>First cell</td><td>Second cell<br><br>Second paragraph in second cell.</td>"),
            "{out}"
        );
    }

    /// A cell chain can run three deep — checked against the Camera LOP page,
    /// which SideFX renders as three real columns (name, shortcut,
    /// description), not one column of nested markup.
    #[test]
    fn a_cell_chain_runs_three_deep() {
        let source = "Look at |\n    #width: 15%\n\n    ((Shift + T)) |\n        * Press it.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(
            out.contains(
                "<td>Look at</td><td><code>Shift + T</code></td><td><ul><li>Press it.</li></ul></td>"
            ),
            "{out}"
        );
    }

    /// A quoted attribute value with a space, e.g. `style="margin-left: 2em"`,
    /// must not split into two tokens — the second half had no `=` and threw
    /// out the whole tag, table cells included. Checked against the real doc
    /// build: `nodes/sop/uvflatten-2.0` draws this `div` as a raw, unparsed
    /// paragraph without the fix. See spec: Local — Quoted attribute with a
    /// space breaks pseudo-HTML tag recognition.
    #[test]
    fn a_quoted_attribute_with_a_space_does_not_reject_the_tag() {
        let source = "div style=\"margin-left: 2em\">> Indented text.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("Indented text."), "{out}");
        assert!(!out.contains("style=\"margin-left"), "{out}");
    }

    /// The same quoted-space attribute, on a `table>>` tag, must still be
    /// reconstructed into a real table rather than falling back to
    /// flattened paragraphs (the fix this spec's example table depends on).
    #[test]
    fn a_quoted_attribute_with_a_space_still_lets_a_table_assemble() {
        let source = "table style=\"margin-left:auto;margin-right:auto;\">>\n    tr>>\n        td>> Alpha\n        td>> Bravo\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("<td>Alpha</td><td>Bravo</td>"), "{out}");
    }

    /// A heading whose closing `=` run does not match its opening run — a
    /// source typo, not a code-block demonstration — is still a heading:
    /// the level comes from the opening run alone. Checked against the real
    /// doc build: `nodes/sop/refine` (`= Using Refine == (includeme)`) and
    /// `ref/utils/gptex` (`== Examples ===`) both reach the reader as a raw
    /// paragraph without the fix. See spec: Local — Heading with mismatched
    /// closing delimiters is rejected outright.
    #[test]
    fn a_heading_with_mismatched_closing_delimiters_still_parses() {
        // A leading paragraph keeps the heading from being taken as the page
        // title (`take_title` only claims a level-one heading that is the
        // very first block) — the real page has other content above it too.
        let source = "Intro.\n\n= Using Refine == (includeme)\n\nBody text.\n";
        let out = crate::markdown::blocks(&crate::parse(source).blocks, 1);
        assert!(out.contains("## <span id=\"includeme\"></span>Using Refine"), "{out}");
        assert!(!out.contains("=="), "{out}");
    }

    /// `nodes/lop/houdinicrowdprocedural` writes its summary above the title
    /// line, and `vop/agentaddclip` a `:warning:`. Both lost their title.
    #[test]
    fn a_title_below_the_summary_or_a_warning_is_still_the_title() {
        let page = crate::parse("#type: node\n\n\"\"\"Sum.\"\"\"\n\n= Crowd =\n\nBody.\n");
        assert_eq!(page.title_text, "Crowd");
        let page = crate::parse(":warning:Deprecated:\n    Old.\n\n= Agent Add Clip =\n\nBody.\n");
        assert_eq!(page.title_text, "Agent Add Clip");
        assert!(matches!(page.blocks.first(), Some(super::Block::Item { .. })));
    }

    /// A heading with no closing `=` at all is not a heading — this keeps
    /// the guard against a line that merely starts with `=`.
    #[test]
    fn a_line_starting_with_equals_and_no_closing_run_is_not_a_heading() {
        assert!(super::heading_parts("= Not a heading at all").is_none());
    }
}
