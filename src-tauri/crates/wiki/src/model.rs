//! The structure one help page becomes. Renderers and the index both read it.

use serde::Serialize;

/// A page title. SideFX titles can carry a de-emphasised part on each side:
/// `= pre |> main <| sub =`.
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct Title {
    pub pre: Option<Vec<Inline>>,
    pub main: Vec<Inline>,
    pub sub: Option<Vec<Inline>>,
}

/// Properties keep their file order, because some of them repeat.
pub type Props = Vec<(String, String)>;

pub fn prop<'a>(props: &'a Props, name: &str) -> Option<&'a str> {
    props
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.as_str())
}

/// A picture's size in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Size {
    pub width: u32,
    pub height: u32,
    /// False for an SVG with a `viewBox` and no width of its own: the ratio
    /// holds, and the page gives it a width.
    pub fixed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Inline {
    Text {
        text: String,
    },
    Bold {
        body: Vec<Inline>,
    },
    Italic {
        body: Vec<Inline>,
    },
    /// `` `code` ``
    Code {
        text: String,
    },
    /// `__File > Open__`, a label in the Houdini interface.
    Ui {
        body: Vec<Inline>,
    },
    /// `<<variable>>`
    Var {
        name: String,
    },
    /// `((Shift + K))`
    Key {
        key: String,
    },
    /// `+(fa-rocket)`
    Glyph {
        name: String,
    },
    /// `[Fold:name]`
    Fold {
        name: String,
    },
    Image {
        src: String,
        /// Read from the file by the engine, so the app can hold the
        /// picture's room before the file arrives.
        #[serde(skip_serializing_if = "Option::is_none")]
        size: Option<Size>,
    },
    Icon {
        src: String,
        size: IconSize,
    },
    Link {
        text: Vec<Inline>,
        target: LinkTarget,
    },
    /// Text the parser could not understand. Kept so nothing is lost.
    Raw {
        text: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IconSize {
    Small,
    Normal,
    Large,
}

/// Where a link points. The typed forms are the reason this parser beats the
/// HTML scraper: the target keeps its meaning instead of becoming a URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LinkTarget {
    /// `/nodes/sop/copy`, or `#anchor` on the same page.
    Wiki {
        path: String,
        anchor: Option<String>,
    },
    Web {
        url: String,
    },
    Node {
        path: String,
    },
    Expression {
        name: String,
    },
    Vex {
        name: String,
    },
    Mantra {
        name: String,
    },
    /// `[Hom:hou.Node#name]`
    Hom {
        path: String,
        member: Option<String>,
    },
    /// `[Py:hapi.Session]`, `[Py:hapi.AttributeInfo#count]`. The HAPI page for
    /// a Python class or function, always under `hapi.` — the doc build drops
    /// that module prefix from the path and keeps it only in the label.
    Py {
        path: String,
        member: Option<String>,
    },
    HScript {
        name: String,
    },
    Wikipedia {
        article: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ListItem {
    pub blocks: Vec<Block>,
    pub props: Props,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Cell {
    pub heading: bool,
    pub blocks: Vec<Block>,
    pub props: Props,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Block {
    Heading {
        level: u8,
        id: Option<String>,
        title: Title,
        props: Props,
        children: Vec<Block>,
    },
    /// `@parameters`, `@related`, `@subtopics` and the rest. Acts as a
    /// top-level heading that also gives its content a meaning.
    Section {
        name: String,
        title: Option<Vec<Inline>>,
        props: Props,
        children: Vec<Block>,
    },
    Paragraph {
        text: Vec<Inline>,
    },
    /// `"""Summary."""`
    Summary {
        text: Vec<Inline>,
    },
    Bullets {
        items: Vec<ListItem>,
    },
    Numbers {
        items: Vec<ListItem>,
    },
    /// `Term:` followed by an indented body.
    Definition {
        term: Vec<Inline>,
        id: Option<String>,
        props: Props,
        children: Vec<Block>,
    },
    /// `:tip:`, `:box:`, `:tab:`, `:col:`, `:fig:`, `:task:` and the rest.
    Item {
        name: String,
        /// The text after the marker, such as the tab label.
        label: Vec<Inline>,
        props: Props,
        children: Vec<Block>,
    },
    /// `:usage: \`float noise(float pos)\``. Signature lines for VEX and HOM.
    Usage {
        signature: String,
        children: Vec<Block>,
    },
    Code {
        language: Option<String>,
        text: String,
    },
    /// `~~~ Or ~~~`, or `~~` which only breaks a run of blocks apart.
    ///
    /// A divider carries whatever is indented under it. On a node page that is
    /// a parameter group: 227 pages put most of their parameters under one.
    Divider {
        label: Option<Vec<Inline>>,
        invisible: bool,
        props: Props,
        children: Vec<Block>,
    },
    Table {
        rows: Vec<Vec<Cell>>,
    },
    /// `:include /path#id/:`
    Include {
        path: String,
        block_id: Option<String>,
        /// A trailing slash asks for the contents of the block, not the block.
        contents_only: bool,
    },
    /// `::[Introduction|intro]` under `@subtopics`.
    Subtopic {
        link: Vec<Inline>,
        children: Vec<Block>,
    },
    /// Embedded HTML, and the indented `tag>>` form.
    Html {
        tag: String,
        attributes: String,
        children: Vec<Block>,
    },
    RawHtml {
        html: String,
    },
}

/// One documented item lifted out of an `@`-section: a parameter under
/// `@parameters`, a method under `@methods`, a variable under
/// `@env_variables`, and so on.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Entry {
    /// The section name, without the `@`.
    pub section: String,
    pub label: String,
    pub id: Option<String>,
    /// The heading the item sits under. For a parameter this is its folder.
    pub folder: Option<String>,
    pub help: String,
    /// Menu entries, which are the definitions nested inside the item.
    pub menu: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HeadingRef {
    pub level: u8,
    pub id: Option<String>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Page {
    pub title: Title,
    /// The plain text of the title, for the index.
    pub title_text: String,
    pub summary: Option<Vec<Inline>>,
    pub props: Props,
    pub blocks: Vec<Block>,
    /// Facts lifted out of the tree so the index does not walk it again.
    pub headings: Vec<HeadingRef>,
    pub entries: Vec<Entry>,
    pub usages: Vec<String>,
    pub links: Vec<LinkTarget>,
    pub includes: Vec<String>,
}

impl Page {
    pub fn prop(&self, name: &str) -> Option<&str> {
        prop(&self.props, name)
    }
    /// `#type:` — `node`, `vex`, `hom`, `shelf` and the rest.
    pub fn page_type(&self) -> Option<&str> {
        self.prop("type")
    }
    /// `#context:` — `sop`, `dop`, `all`.
    pub fn context(&self) -> Option<&str> {
        self.prop("context")
    }
    /// `#internal:` — the node type name, such as `lattice`.
    pub fn internal(&self) -> Option<&str> {
        self.prop("internal")
    }
    /// The documented parameters of a node.
    pub fn parameters(&self) -> impl Iterator<Item = &Entry> {
        self.entries.iter().filter(|e| e.section == "parameters")
    }
}
