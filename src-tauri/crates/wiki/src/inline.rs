//! Inline markup: styles, keys, links, icons and the typography rules.

use crate::model::{IconSize, Inline, LinkTarget};

pub fn parse(text: &str) -> Vec<Inline> {
    Parser::new(text).run()
}

/// The plain text of a run of inlines. Used for titles, headings and the index.
pub fn plain(inlines: &[Inline]) -> String {
    let mut out = String::new();
    write_plain(inlines, &mut out);
    out
}

fn write_plain(inlines: &[Inline], out: &mut String) {
    for inline in inlines {
        match inline {
            Inline::Text { text } | Inline::Raw { text } | Inline::Code { text } => {
                out.push_str(text)
            }
            Inline::Var { name } => out.push_str(name),
            Inline::Key { key } => out.push_str(key),
            Inline::Bold { body } | Inline::Italic { body } | Inline::Ui { body } => {
                write_plain(body, out)
            }
            Inline::Link { text, .. } => write_plain(text, out),
            Inline::Glyph { .. }
            | Inline::Fold { .. }
            | Inline::Image { .. }
            | Inline::Icon { .. } => {}
        }
    }
}

struct Parser<'a> {
    src: &'a [u8],
    text: &'a str,
    pos: usize,
    out: Vec<Inline>,
    buf: String,
}

impl<'a> Parser<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            src: text.as_bytes(),
            text,
            pos: 0,
            out: Vec::new(),
            buf: String::new(),
        }
    }

    fn run(mut self) -> Vec<Inline> {
        while self.pos < self.src.len() {
            if self.try_token() {
                continue;
            }
            self.push_char();
        }
        self.flush();
        self.out
    }

    fn flush(&mut self) {
        if !self.buf.is_empty() {
            let text = std::mem::take(&mut self.buf);
            self.out.push(Inline::Text { text });
        }
    }

    fn push(&mut self, inline: Inline) {
        self.flush();
        self.out.push(inline);
    }

    /// Advance one character, applying the typography replacements.
    fn push_char(&mut self) {
        let rest = &self.text[self.pos..];
        for (from, to) in TYPOGRAPHY {
            if rest.starts_with(from) {
                self.buf.push_str(to);
                self.pos += from.len();
                return;
            }
        }
        let c = rest.chars().next().expect("position is on a boundary");
        self.buf.push(c);
        self.pos += c.len_utf8();
    }

    fn rest(&self) -> &'a str {
        &self.text[self.pos..]
    }

    fn try_token(&mut self) -> bool {
        let rest = self.rest();
        match self.src[self.pos] {
            b'`' => self.code(rest),
            b'[' => self.bracket(rest),
            b'<' if rest.starts_with("<<") => {
                self.wrapped(rest, "<<", ">>", |name| Inline::Var { name })
            }
            b'(' if rest.starts_with("((") => {
                self.wrapped(rest, "((", "))", |key| Inline::Key { key })
            }
            b'+' if rest.starts_with("+(") => {
                self.wrapped(rest, "+(", ")", |name| Inline::Glyph { name })
            }
            b'_' if rest.starts_with("__") => self.style(rest, "__", |body| Inline::Ui { body }),
            b'*' => self.style(rest, "*", |body| Inline::Bold { body }),
            b'_' => self.style(rest, "_", |body| Inline::Italic { body }),
            _ => false,
        }
    }

    fn code(&mut self, rest: &str) -> bool {
        let Some(end) = rest[1..].find('`') else {
            return false;
        };
        let text = rest[1..1 + end].to_string();
        self.push(Inline::Code { text });
        self.pos += end + 2;
        true
    }

    fn wrapped(
        &mut self,
        rest: &str,
        open: &str,
        close: &str,
        make: impl Fn(String) -> Inline,
    ) -> bool {
        let Some(end) = rest[open.len()..].find(close) else {
            return false;
        };
        let body = rest[open.len()..open.len() + end].to_string();
        self.push(make(body));
        self.pos += open.len() + end + close.len();
        true
    }

    /// A style marker only opens at a word boundary and only closes on
    /// non-space, so `4x4`, `snake_case` and `a * b` stay as they are.
    fn style(&mut self, rest: &str, marker: &str, make: impl Fn(Vec<Inline>) -> Inline) -> bool {
        if !self.at_word_start() {
            return false;
        }
        let body_start = marker.len();
        if rest[body_start..].starts_with(char::is_whitespace) {
            return false;
        }
        let mut search = body_start;
        let end = loop {
            let Some(found) = rest[search..].find(marker) else {
                return false;
            };
            let at = search + found;
            let before = rest[..at].chars().next_back();
            let after = &rest[at + marker.len()..];
            let closes = before.is_some_and(|c| !c.is_whitespace())
                && (after.is_empty()
                    || after
                        .chars()
                        .next()
                        .is_some_and(|c| !c.is_alphanumeric() || marker == "__"));
            if closes {
                break at;
            }
            search = at + marker.len();
        };
        let body = parse(&rest[body_start..end]);
        self.push(make(body));
        self.pos += end + marker.len();
        true
    }

    fn at_word_start(&self) -> bool {
        match self.text[..self.pos].chars().next_back() {
            None => true,
            Some(c) => !c.is_alphanumeric(),
        }
    }

    /// `[...]` covers links, shortcuts, images, icons and folds.
    fn bracket(&mut self, rest: &str) -> bool {
        let Some(end) = find_close_bracket(rest) else {
            return false;
        };
        let body = &rest[1..end];
        let Some(inline) = parse_bracket(body) else {
            return false;
        };
        self.push(inline);
        self.pos += end + 1;
        true
    }
}

/// Brackets nest, because link text can hold an icon.
fn find_close_bracket(rest: &str) -> Option<usize> {
    let mut depth = 0usize;
    for (i, c) in rest.char_indices() {
        match c {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn parse_bracket(body: &str) -> Option<Inline> {
    let (text, target) = match body.split_once('|') {
        Some((text, target)) => (Some(text.trim()), target.trim()),
        None => (None, body.trim()),
    };
    // `[-1,-1]`, `[0]` and `[-1..1]` are a value in the prose, not a link.
    if !target.chars().any(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    if let Some((scheme, value)) = split_shortcut(target) {
        let value = value.trim();
        let target_kind = match scheme.as_str() {
            "image" => {
                return Some(Inline::Image {
                    src: value.into(),
                    size: None,
                });
            }
            "smallicon" => {
                return Some(Inline::Icon {
                    src: value.into(),
                    size: IconSize::Small,
                });
            }
            "icon" => {
                return Some(Inline::Icon {
                    src: value.into(),
                    size: IconSize::Normal,
                });
            }
            "largeicon" => {
                return Some(Inline::Icon {
                    src: value.into(),
                    size: IconSize::Large,
                });
            }
            "fold" => return Some(Inline::Fold { name: value.into() }),
            // `Key:h.pane.gview.sel.patternset` names a hotkey action. SideFX
            // shows the key the action is bound to, from a table this app does
            // not read, so the action itself is shown. It is not a page.
            "key" => return Some(Inline::Key { key: text.unwrap_or(value).into() }),
            // `Hweb:Request` is a page of the `hwebserver` module.
            "hweb" => wiki_target(&format!("/hwebserver/{value}")),
            // `Link:` and `Attr:` say nothing about the target beyond "this is
            // a link"; what follows is an ordinary help path, relative or not.
            // `Attr:` names an attribute reference specifically, but points at
            // the same kind of page.
            "link" | "attr" => wiki_target(value),
            // A shelf tool lives under the shelf section, the same way a node
            // lives under `nodes`. Left alone, the name reads as a page beside
            // whatever page wrote the link. `Tool:`, `Small:` and `Large:` are
            // the same link at three icon sizes, and some of them already
            // write the section into the value.
            "shelf" | "tool" | "small" | "large" => match value.starts_with('/') {
                true => wiki_target(value),
                false => wiki_target(&format!("/shelf/{value}")),
            },
            // `Nodes:` and the misspelt `Npde:` are `Node:`.
            // `Node:nodes/out/gltf` and `Node:sop/rigstashpose.html` are
            // written too.
            "node" | "nodes" | "npde" => {
                let path = value.trim_start_matches('/');
                let path = path.strip_prefix("nodes/").unwrap_or(path);
                LinkTarget::Node {
                    path: path.strip_suffix(".html").unwrap_or(path).into(),
                }
            }
            "exp" => LinkTarget::Expression { name: value.into() },
            "vex" => LinkTarget::Vex { name: value.into() },
            "mantra" => LinkTarget::Mantra { name: value.into() },
            "cmd" => LinkTarget::HScript { name: value.into() },
            // Every HAPI cross-reference is written against the `hapi`
            // module, so the doc build drops it from the path and keeps it
            // only in the label: `hapi.AttributeInfo#count` links to
            // `AttributeInfo.html#count`. A Python module other than `hapi`
            // — `pdg`, `pdgd` — has no flat namespace of its own: it is an
            // ordinary wiki page under `tops`, so `pdg.WorkItem#addAttrib`
            // links to `tops/pdg/WorkItem#addAttrib` and the bare `pdg#attrib`
            // (no class) links to the module's own page, `tops/pdg#attrib`.
            "py" => {
                let (module, class, member) = match split_first(value, &['.', '#']) {
                    None => (value, "", None),
                    Some((module, '#', rest)) => (module, "", Some(rest)),
                    Some((module, _, rest)) => match split_first(rest, &['.', '#']) {
                        None => (module, rest, None),
                        Some((class, _, member)) => (module, class, Some(member)),
                    },
                };
                if module == "hapi" {
                    LinkTarget::Py {
                        path: class.to_string(),
                        member: member.map(str::to_string),
                    }
                } else {
                    // Absolute, with a leading slash: `assets::link` treats
                    // anything else as relative to the page the link sits on,
                    // which is almost never `tops`.
                    let path = if class.is_empty() {
                        format!("/tops/{module}")
                    } else {
                        format!("/tops/{module}/{class}")
                    };
                    let label = match (class.is_empty(), member) {
                        (true, Some(m)) => format!("{module}.{m}"),
                        (true, None) => module.to_string(),
                        (false, Some(m)) => format!("{module}.{class}.{m}"),
                        (false, None) => format!("{module}.{class}"),
                    };
                    let target = LinkTarget::Wiki {
                        path,
                        anchor: member.map(str::to_string),
                    };
                    return Some(link(Some(&label), value, target));
                }
            }
            "wp" => LinkTarget::Wikipedia {
                article: value.into(),
            },
            // `Hou:hou.clone.deleteClone` is a `Hom:` link under another name.
            "hom" | "hou" => {
                let (path, member) = match value.split_once('#') {
                    Some((path, member)) => (path.to_string(), Some(member.to_string())),
                    None => (value.to_string(), None),
                };
                LinkTarget::Hom { path, member }
            }
            "http" | "https" | "ftp" | "mailto" => LinkTarget::Web {
                url: target.to_string(),
            },
            _ => wiki_target(target),
        };
        // The value, not the whole shortcut: a link with no label of its own
        // falls back to this text, and `Tool:whitewater` is not what the
        // reader should see on the page.
        return Some(link(text, value, target_kind));
    }
    Some(link(text, target, wiki_target(target)))
}

fn link(text: Option<&str>, target_text: &str, target: LinkTarget) -> Inline {
    let text = match text {
        Some(text) => parse(text),
        None => default_text(&target, target_text),
    };
    Inline::Link { text, target }
}

/// A shortcut with no text of its own shows the name it points at.
fn default_text(target: &LinkTarget, raw: &str) -> Vec<Inline> {
    let text = match target {
        LinkTarget::Node { path } => path.rsplit('/').next().unwrap_or(path).to_string(),
        LinkTarget::Expression { name }
        | LinkTarget::Vex { name }
        | LinkTarget::Mantra { name }
        | LinkTarget::HScript { name } => name.clone(),
        LinkTarget::Hom { path, member } => match member {
            Some(member) => format!("{path}.{member}"),
            None => path.clone(),
        },
        LinkTarget::Py { path, member } => match member {
            Some(member) => format!("hapi.{path}.{member}"),
            None => format!("hapi.{path}"),
        },
        LinkTarget::Wikipedia { article } => article.replace('_', " "),
        // A bare URL shows itself, and `https` is part of it. `raw` here is
        // the value after the scheme, which would drop it.
        LinkTarget::Web { url } => url.clone(),
        _ => raw.to_string(),
    };
    vec![Inline::Text { text }]
}

fn wiki_target(target: &str) -> LinkTarget {
    // `[trace|drawing|#trace]` is written in the help with one pipe too many.
    // The label was taken from the first field, so what is left here is the
    // target and the leftovers of the typo. The last field is the real target.
    let target = target.rsplit('|').next().unwrap_or(target);
    // `[hou.Parm]` and `[Hom.hou.qt#mainWindow]` are `Hom:` links with the
    // colon left out. No page name starts with `hou.`.
    let hom = target.strip_prefix("Hom.").unwrap_or(target);
    if hom.starts_with("hou.") {
        let (path, member) = match hom.split_once('#') {
            Some((path, member)) => (path.to_string(), Some(member.to_string())),
            None => (hom.to_string(), None),
        };
        return LinkTarget::Hom { path, member };
    }
    if let Some(rest) = target.strip_prefix('#') {
        return LinkTarget::Wiki {
            path: String::new(),
            anchor: Some(rest.to_string()),
        };
    }
    let (path, anchor) = match target.split_once('#') {
        Some((path, anchor)) => (path, Some(anchor.to_string())),
        None => (target, None),
    };
    LinkTarget::Wiki {
        // The help links to the page the doc build WRITES, which is HTML. The
        // app reads the source the build writes it from, and that has no
        // suffix at all.
        path: path.strip_suffix(".html").unwrap_or(path).to_string(),
        anchor,
    }
}

/// Splits `s` on the first byte in `seps`, returning the piece before it, the
/// separator that matched, and the piece after. `None` when none of `seps`
/// appears at all.
fn split_first<'a>(s: &'a str, seps: &[char]) -> Option<(&'a str, char, &'a str)> {
    let i = s.find(seps)?;
    let sep = s[i..].chars().next().expect("find() landed on a boundary");
    Some((&s[..i], sep, &s[i + sep.len_utf8()..]))
}

/// `Node:sop/copy` gives `("node", "sop/copy")`. A path such as `/nodes/sop`
/// and a time such as `12:30` must not match, so the scheme is letters only.
fn split_shortcut(target: &str) -> Option<(String, &str)> {
    let (scheme, rest) = target.split_once(':')?;
    if scheme.is_empty() || !scheme.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), rest))
}

const TYPOGRAPHY: &[(&str, &str)] = &[
    ("<-", "\u{2190}"),
    ("->", "\u{2192}"),
    ("<=", "\u{2264}"),
    ("=>", "\u{21d2}"),
    ("...", "\u{2026}"),
    ("(c)", "\u{a9}"),
    ("(C)", "\u{a9}"),
    ("(tm)", "\u{2122}"),
    ("(TM)", "\u{2122}"),
    ("(r)", "\u{ae}"),
    ("(R)", "\u{ae}"),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn target(text: &str) -> LinkTarget {
        match parse(text).as_slice() {
            [Inline::Link { target, .. }] => target.clone(),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_value_in_brackets_is_not_a_link() {
        let text = parse("not at [-1,-1], from [-1..1], index [0]");
        assert!(!text.iter().any(|inline| matches!(inline, Inline::Link { .. })), "{text:?}");
    }

    #[test]
    fn a_shortcut_is_read_the_way_the_help_means_it() {
        let action = "h.pane.gview.sel.patternset";
        assert_eq!(parse(&format!("[Key:{action}]")), vec![Inline::Key { key: action.into() }]);
        let wiki = |path: &str| LinkTarget::Wiki { path: path.into(), anchor: None };
        assert_eq!(target("[Hweb:Request]"), wiki("/hwebserver/Request"));
        assert_eq!(target("[hou.Parm]"), LinkTarget::Hom { path: "hou.Parm".into(), member: None });
        assert_eq!(
            target("[main window|Hom.hou.qt#mainWindow]"),
            LinkTarget::Hom { path: "hou.qt".into(), member: Some("mainWindow".into()) }
        );
        assert_eq!(target("[Node:nodes/out/gltf]"), LinkTarget::Node { path: "out/gltf".into() });
        assert_eq!(target("[Node:sop/rigstashpose.html]"), LinkTarget::Node { path: "sop/rigstashpose".into() });
    }
}
