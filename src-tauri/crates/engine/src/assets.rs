//! Turns a reference written beside a help page into the path the app reads:
//! a picture or video for the `himage` protocol, and a link for the router.
//!
//! A page writes its assets the way the SideFX help server serves them, which
//! is not the way the install stores them:
//!
//! - `/images/playbar/timeline.png` is `playbar/timeline.png` in `images.zip`.
//! - `../images/BasisSOP.jpg` on `nodes/sop/basis` is `nodes/BasisSOP.jpg` in
//!   the same zip. The `images` segment is a serving path, not a folder.
//! - `/videos/tween.webm` is a loose file under `$HFS/houdini/help/videos`.
//! - `/movies/rotate.gif` is the same shape as `videos`, under the name a
//!   package's own help folder uses for it — SideFX Labs ships no `videos/`.
//!
//! All three come back as one shape, `images/…`, `videos/…` or `movies/…`, so
//! the protocol handler has one thing to read and the front-end has nothing
//! to know.

use wiki::{Block, Inline, LinkTarget};

/// The asset path for `src` as written on the page at `page`, or `None` when
/// the reference names nothing this app can read.
pub fn resolve(page: &str, src: &str) -> Option<String> {
    // `opdef:` and `./MainImage.jpg` name a picture inside an HDA, which is
    // not a file in the install. Only the pages about writing help use them.
    if src.starts_with("opdef:") || src.contains('?') || src.is_empty() {
        return None;
    }

    let mut parts: Vec<&str> = Vec::new();
    if !src.starts_with('/') {
        // A relative reference stands beside the page, so the page's own name
        // is not part of the base.
        let dir = page
            .trim_matches('/')
            .rsplit_once('/')
            .map_or("", |(d, _)| d);
        parts.extend(dir.split('/'));
    }
    parts.extend(src.split('/'));

    let mut path: Vec<&str> = Vec::new();
    for part in parts {
        match part {
            "" | "." => {}
            ".." => {
                path.pop()?;
            }
            part => path.push(part),
        }
    }

    // The first `images`, `videos` or `movies` segment says which store holds
    // the file. Everything before it is the section the page lives in, which
    // the store keeps as its own top folder.
    let at = path.iter().position(|p| *p == "images" || *p == "videos" || *p == "movies")?;
    let store = path.remove(at);
    if path.len() <= at {
        return None;
    }
    Some(format!("{store}/{}", path.join("/")))
}

/// The app path for a wiki link written beside the page rather than from the
/// help root. `news/22/index` writes `[Solaris|solaris]`, and that means
/// `/news/22/solaris`, not a page under the index.
///
/// ponytail: the base is the folder the page name sits in, so a page read at
/// its folder form (`news/22` instead of `news/22/index`) bases one level too
/// high. The index writes the `/index` form for every folder page, so only a
/// hand-written address reaches the other one.
pub fn link(page: &str, target: &str) -> Option<String> {
    if target.is_empty() || target.starts_with('/') {
        return None;
    }
    let dir = page
        .trim_matches('/')
        .rsplit_once('/')
        .map_or("", |(dir, _)| dir);

    let mut path: Vec<&str> = Vec::new();
    for part in dir.split('/').chain(target.split('/')) {
        match part {
            "" | "." => {}
            ".." => {
                path.pop()?;
            }
            part => path.push(part),
        }
    }
    // A single segment is a section, not a page, and nothing links to one.
    if path.len() < 2 {
        return None;
    }
    Some(format!("/{}", path.join("/")))
}

/// What `rewrite` asks about the pages a link can point at.
pub struct Links<'a> {
    /// The title of a page, or `None` when there is no such page.
    pub name_of: &'a dyn Fn(&str) -> Option<String>,
    /// Whether there is such a page, without reading it.
    pub exists: &'a dyn Fn(&str) -> bool,
    /// The size of a picture, by the path `resolve` wrote.
    pub size_of: &'a dyn Fn(&str) -> Option<wiki::Size>,
}

/// Rewrites every asset reference in a page to the path the `himage` protocol
/// reads. A reference that names nothing readable is dropped, so the reader
/// gets the text without a broken frame in the middle of it.
pub fn rewrite(page: &str, blocks: &mut [Block], links: &Links) {
    for block in blocks {
        match block {
            Block::Item {
                name,
                label,
                props,
                children,
            } => {
                if name == "video" {
                    for (key, value) in props.iter_mut() {
                        if key == "src" {
                            *value = resolve(page, value).unwrap_or_default();
                        }
                    }
                }
                inlines(page, label, links);
                rewrite(page, children, links);
            }
            Block::Heading {
                title, children, ..
            } => {
                inlines(page, &mut title.main, links);
                rewrite(page, children, links);
            }
            Block::Section { children, .. } => rewrite(page, children, links),
            Block::Definition { term, children, .. } => {
                inlines(page, term, links);
                rewrite(page, children, links);
            }
            Block::Usage { children, .. } => rewrite(page, children, links),
            Block::Paragraph { text } | Block::Summary { text } => inlines(page, text, links),
            Block::Subtopic { link, children } => {
                inlines(page, link, links);
                rewrite(page, children, links);
            }
            Block::Bullets { items } | Block::Numbers { items } => {
                for item in items {
                    rewrite(page, &mut item.blocks, links);
                }
            }
            Block::Table { rows } => {
                for row in rows {
                    for cell in row {
                        rewrite(page, &mut cell.blocks, links);
                    }
                }
            }
            Block::Html { children, .. } => rewrite(page, children, links),
            Block::Divider { children, .. } => rewrite(page, children, links),
            Block::Code { .. }
            | Block::Include { .. }
            | Block::RawHtml { .. } => {}
        }
    }
}

fn inlines(page: &str, inlines: &mut Vec<Inline>, links: &Links) {
    inlines.retain_mut(|inline| match inline {
        Inline::Image { src, size } => match resolve(page, src) {
            Some(path) => {
                *size = (links.size_of)(&path);
                *src = path;
                true
            }
            None => false,
        },
        Inline::Bold { body } | Inline::Italic { body } | Inline::Ui { body } => {
            self::inlines(page, body, links);
            true
        }
        Inline::Link { text, target } => {
            if let LinkTarget::Hom { path, member: None } = target
                && let Some(found) = hom_page(path, links.exists)
            {
                *target = found;
            }
            if let LinkTarget::Wiki { path, .. } = target {
                // `[intro]` names a page and shows the address; SideFX shows
                // the page's title there instead.
                let bare = matches!(text.as_slice(), [Inline::Text { text }] if text == path);
                if let Some(resolved) = link(page, path) {
                    // `[Rig Pose|nodes/sop/kinefx--rigpose]` leaves out the
                    // first slash. Beside its page it names nothing, so the
                    // help root is tried too.
                    let rooted = format!("/{path}");
                    *path = match !(links.exists)(&resolved) && (links.exists)(&rooted) {
                        true => rooted,
                        false => resolved,
                    };
                }
                if bare && let Some(found) = (links.name_of)(path) {
                    *text = vec![Inline::Text { text: found }];
                }
            }
            self::inlines(page, text, links);
            true
        }
        _ => true,
    });
}

/// The page a `Hom:` link names, where its plain path names nothing.
///
/// `hou.node` is a function, and the doc build writes it as `node_`: a disk
/// that ignores case would give it the same file as the class `hou.Node`.
/// `hou.Node.parm` is a method, and a method is a heading on its class page.
/// A module's function can be a page (`hou.clone.clone`) or a heading
/// (`hou.ui.colorFromName`), so only the pages can say which. A name that
/// starts in upper case is a class, and a class has its own page.
fn hom_page(path: &str, exists: &dyn Fn(&str) -> bool) -> Option<LinkTarget> {
    let page = format!("/hom/{}", path.replace('.', "/"));
    let (parent, name) = page.rsplit_once('/')?;
    if !name.starts_with(|c: char| c.is_ascii_lowercase()) || exists(&page) {
        return None;
    }
    let renamed = format!("{page}_");
    if exists(&renamed) {
        return Some(LinkTarget::Wiki { path: renamed, anchor: None });
    }
    // `/hom/hou` is the module itself, which no link means.
    if parent.matches('/').count() >= 3 && exists(parent) {
        return Some(LinkTarget::Wiki {
            path: parent.to_string(),
            anchor: Some(name.to_string()),
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{hom_page, link, resolve};
    use wiki::LinkTarget;

    #[test]
    fn a_hom_link_finds_the_page_the_doc_build_wrote() {
        let pages = ["/hom/hou/Node", "/hom/hou/node_", "/hom/hou/ui", "/hom/hou/clone/clone"];
        let exists = |path: &str| pages.contains(&path);
        let wiki = |path: &str, anchor: Option<&str>| {
            Some(LinkTarget::Wiki { path: path.into(), anchor: anchor.map(str::to_string) })
        };
        assert_eq!(hom_page("hou.node", &exists), wiki("/hom/hou/node_", None));
        assert_eq!(hom_page("hou.Node.parm", &exists), wiki("/hom/hou/Node", Some("parm")));
        assert_eq!(hom_page("hou.ui.colorFromName", &exists), wiki("/hom/hou/ui", Some("colorFromName")));
        assert_eq!(hom_page("hou.clone.clone", &exists), None);
        assert_eq!(hom_page("hou.Node", &exists), None);
        assert_eq!(hom_page("hou.nothing", &exists), None);
    }

    #[test]
    fn a_relative_link_stands_beside_its_page() {
        assert_eq!(
            link("news/22/index", "solaris").as_deref(),
            Some("/news/22/solaris")
        );
        assert_eq!(
            link("news/22/karma", "solaris").as_deref(),
            Some("/news/22/solaris")
        );
        assert_eq!(
            link("nodes/sop/box", "../../vex/functions/lerp").as_deref(),
            Some("/vex/functions/lerp")
        );
    }

    #[test]
    fn an_absolute_link_is_left_alone() {
        assert_eq!(link("news/22/index", "/nodes/sop/box"), None);
        assert_eq!(link("news/22/index", ""), None);
    }

    #[test]
    fn a_link_that_leaves_the_help_root_is_refused() {
        assert_eq!(link("news/22/index", "../../../elsewhere"), None);
        assert_eq!(link("news/index", "solaris").as_deref(), Some("/news/solaris"));
    }

    #[test]
    fn absolute_image_drops_the_serving_folder() {
        assert_eq!(
            resolve("basics/playbar", "/images/playbar/timeline.png").as_deref(),
            Some("images/playbar/timeline.png")
        );
    }

    #[test]
    fn a_relative_image_keeps_the_section_it_came_from() {
        assert_eq!(
            resolve("nodes/sop/basis", "../images/BasisSOP.jpg").as_deref(),
            Some("images/nodes/BasisSOP.jpg")
        );
        assert_eq!(
            resolve("nodes/cop2/rotoshape", "../images/RotoShapeEditMode.jpg").as_deref(),
            Some("images/nodes/RotoShapeEditMode.jpg")
        );
    }

    #[test]
    fn an_empty_segment_is_not_a_folder() {
        assert_eq!(
            resolve(
                "nodes/lop/rendergeometrysettings",
                "//images/solaris/kug/a.jpg"
            )
            .as_deref(),
            Some("images/solaris/kug/a.jpg")
        );
    }

    #[test]
    fn a_video_reads_from_the_videos_folder() {
        assert_eq!(
            resolve("anim/animtoolbar", "/videos/animtoolbar_tween.webm").as_deref(),
            Some("videos/animtoolbar_tween.webm")
        );
    }

    #[test]
    fn a_picture_inside_an_asset_is_not_a_file() {
        assert_eq!(resolve("help/nodes", "opdef:.?test.png"), None);
        assert_eq!(
            resolve("help/nodes", "opdef:matt::Sop/e::1.0?test.png"),
            None
        );
        assert_eq!(resolve("help/nodes", "./MainImage.jpg"), None);
    }

    #[test]
    fn a_reference_that_leaves_the_help_root_is_refused() {
        assert_eq!(resolve("basics/playbar", "../../../images/x.png"), None);
        assert_eq!(resolve("basics/playbar", "/images"), None);
    }
}
