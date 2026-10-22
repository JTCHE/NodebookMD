import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { warm } from "@/lib/pages";
import { showToast } from "@/components/ui/toast-notification";
import { findAnchor, jumpTo } from "./toc/measure";
import { DocTooltip, LinkTooltip, SectionTooltip, registerSlug, usePageMark, warmPreview } from "./Tooltip";
import { Icons } from "@/lib/ui/icons";
import DocIconClient from "./markdown/DocIconClient";

// Shared across all DocLink instances so a link-dense page (1000+ links) uses
// one observer instead of one per link. A link is warmed only once it is
// actually scrolled into view, not on mount: a page link asks for its page's
// name, an outside address for its share card, so the tooltip opens full.
let linkObserver: IntersectionObserver | null = null;
const observedLinks = new WeakMap<Element, () => void>();

function getLinkObserver() {
  if (linkObserver) return linkObserver;
  linkObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observedLinks.get(entry.target)?.();
        linkObserver!.unobserve(entry.target);
        observedLinks.delete(entry.target);
      }
    },
    { rootMargin: "200px" },
  );
  return linkObserver;
}

// Links pop by weight and contrast, not by colour: 500 against the prose's 400,
// at the top of the ramp where the prose sits at neutral-700. The hover dims
// the whole link, text and rule together, because opacity interpolates in both
// themes and a colour that suits the light theme goes wrong in the dark one.
// Weight and offset never change, so a paragraph never reflows under the pointer.
const LINK =
  "text-brand font-medium no-underline decoration-[0.5px] " +
  "hover:opacity-75 hover:underline transition-opacity transition-colors motion-reduce:transition-none " +
  "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/**
 * Every link in the reading view. An app path opens in the window; an external
 * address opens in the reader's browser. Pointing at an app link says what is
 * on the other side of it.
 */
export default function DocLink({
  href,
  children,
  className,
  underline = true,
  fullWidth = false,
  mark = true,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  underline?: boolean;
  fullWidth?: boolean;
  /** Draw the page's own icon in front of the name. Off for a link whose
      markup already carries an icon — the card grids, where the help writes
      the image itself. */
  mark?: boolean;
}) {
  const classes = cn(underline && LINK, fullWidth && "w-full", className);
  const [visible, setVisible] = useState(false);
  // The next page can reuse this link for another href at the same place in
  // the tree. The pointer never left it, so the old tooltip stayed up and
  // named the new link's page.
  const [shownHref, setShownHref] = useState(href);
  if (shownHref !== href) {
    setShownHref(href);
    setVisible(false);
  }
  const linkRef = useRef<HTMLAnchorElement>(null);
  // Which visual line the pointer entered on, for wrapped multi-line links —
  // null on keyboard focus, where there is no cursor position to anchor to.
  const hoverPosRef = useRef<{ x: number; y: number } | null>(null);

  const external = /^[a-z]+:/i.test(href);
  // The help's own links to other pages are written `#/nodes/sop/box`: the
  // markdown has to work in a plain viewer, where the app's route is a hash.
  // Read as written, that `#` says "a place on this page", and the link goes
  // nowhere, says "Already on this page", and has no page to name in a
  // tooltip. The leading hash belongs to the route, so it comes off here.
  const to = href.startsWith("#/") ? href.slice(1) : href;
  const hashAt = to.indexOf("#");
  const anchor = hashAt >= 0 ? to.slice(hashAt + 1) : null;
  // The tooltip names a page, so it needs the page and not the heading in it.
  // A link that is only an anchor has no page of its own: it means this page.
  const path = hashAt >= 0 ? to.slice(0, hashAt) : to;
  const anchorOnly = hashAt >= 0 && path === "";
  const slug = external ? null : path.replace(/^\/+/, "");
  // A link to the home page has an empty slug too — same as an anchor-only
  // link — but it is a real page, not "this page", so it needs its own
  // pathname check rather than falling into the anchor-only case.
  //
  // Read from the address when it is needed, not from the router: a link that
  // subscribed to the location re-rendered on every press, and an index page
  // holds two thousand of them.
  const samePage = () => !external && (anchorOnly || window.location.pathname === `/${slug}`);

  /* Every link to a page in the help wears that page's icon. A name with its
     glyph in front of it is recognised before it is read, and the icon is the
     same one the panel and the search draw for that page. The answer arrives
     with the batch the tooltips already ask for, so a link costs no call of
     its own. A link to the open page wears it too: in a "see also" list it
     sits among its siblings, and a row without the glyph reads as broken. */
  const marked = mark && !external && !!slug;
  const meta = usePageMark(marked ? slug : null);
  const glyph = marked ? (
    meta?.icon ? (
      <DocIconClient
        src={meta.icon}
        alt=""
        className="doc-icon mr-0.75 ml-0.5"
        // The install ships a few pages with no icon file. A page with no
        // glyph beside a page with one reads as a fault, so it gets the plain
        // page mark.
        fallback={<Icons.page className="mr-0.75 ml-0.5 inline size-[1em] align-[-0.15em]" />}
      />
    ) : (
      <Icons.page className="mr-0.75 ml-0.5 inline size-[1em] align-[-0.15em]" />
    )
  ) : null;

  const web = /^https?:/i.test(href);
  useEffect(() => {
    const el = linkRef.current;
    if (!el || (!slug && !web)) return;
    const observer = getLinkObserver();
    observedLinks.set(el, slug ? () => registerSlug(slug) : () => warmPreview(href));
    observer.observe(el);
    return () => {
      observer.unobserve(el);
      observedLinks.delete(el);
    };
  }, [slug, web, href]);

  const hover = {
    onMouseEnter: (e: React.MouseEvent) => {
      hoverPosRef.current = { x: e.clientX, y: e.clientY };
      setVisible(true);
    },
    onMouseLeave: () => setVisible(false),
    // Keyboard focus only. A click focuses the link too, and the window
    // focuses it again when the reader comes back from the browser an
    // external link opened, with the pointer elsewhere: no leave would put
    // that tooltip away.
    onFocus: (e: React.FocusEvent) => {
      if (!e.currentTarget.matches(":focus-visible")) return;
      hoverPosRef.current = null;
      setVisible(true);
    },
    onBlur: () => setVisible(false),
  };
  const anchored = { anchorRef: linkRef, hoverPosRef };
  // An address off the machine gets its share card, an anchor on this page
  // gets the words it lands on, and a page in the help gets its name.
  const tooltip = !visible ? null : external ? (
    web && <LinkTooltip url={href} {...anchored} />
  ) : samePage() && anchor ? (
    <SectionTooltip id={decodeURIComponent(anchor)} {...anchored} />
  ) : (
    slug && <DocTooltip slug={slug} {...anchored} />
  );

  if (external) {
    return (
      <>
        <a
          ref={linkRef}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
          {...hover}
          // The browser opens over the window, and the pointer leaves the
          // link with no leave event.
          onClick={() => setVisible(false)}
        >
          {children}
        </a>
        {tooltip}
      </>
    );
  }

  return (
    <span className={cn("relative", fullWidth ? "block w-full" : "inline")}>
      <Link
        ref={linkRef}
        to={to}
        className={cn(classes, "cursor-interactive")}
        onClick={(e) => {
          // The pointer does not leave a link that the next page draws in
          // the same place, so the tooltip is put away here.
          setVisible(false);
          // A link to the page already open is not a navigation. The anchor
          // cases settle here, and the click never reaches the router.
          if (!samePage()) return;
          e.preventDefault();
          if (!anchor) {
            showToast("Already on this page");
            return;
          }
          const target = findAnchor(decodeURIComponent(anchor));
          if (target) jumpTo(target);
          else showToast(`This page has no section named "${anchor}"`, "error");
        }}
        // Start reading the page the pointer is travelling towards. Every
        // other link in the app does this — the sidebar rows, the library, the
        // bookmarks — and a doc link that did not was the one link in the
        // window that always opened cold. See `warm` in lib/pages.
        onPointerEnter={() => {
          if (!samePage() && slug) warm(slug);
        }}
        {...hover}
      >
        {glyph}
        {children}
      </Link>
      {tooltip}
    </span>
  );
}
