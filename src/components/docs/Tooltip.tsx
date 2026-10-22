import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import { invoke } from "../../lib/backend";
import { cn } from "@/lib/utils";
import { hitOf } from "@/lib/search";

interface MetaEntry {
  title: string;
  summary: string;
  /** The page's own icon inside `icons.zip`, or null where it has none. */
  icon: string | null;
}

// Module-level caches shared across all DocTooltip instances in this session.
// `null` marks a page that is not in the build, so a second hover does not
// ask again.
const metaCache = new Map<string, MetaEntry | null>();

/** What a batch settles a slug to: the page, `null` for no such page, or
    `undefined` when the call failed and nothing is known. */
type Settled = MetaEntry | null | undefined;

// Slugs waiting for the next call. The site asked per link; here one Rust call
// answers a batch, so a viewport full of links is one round trip and not one
// per link.
// `urgent` is what a reader is pointing at right now; it is drained first, so a
// hover never waits behind the viewport warming that queued before it.
const urgent = new Set<string>();
const pending = new Set<string>();
const waiting = new Map<string, Set<(entry: Settled) => void>>();
let scheduled: ReturnType<typeof setTimeout> | null = null;

const BATCH_MS = 30;
// A shelf page puts a thousand links in view at once. The whole viewport in one
// call would hold the database lock while the reader is still reading, so the
// queue is drained a slice at a time.
const BATCH_MAX = 128;

function flush() {
  scheduled = null;
  const paths = [...urgent, ...pending].slice(0, BATCH_MAX);
  for (const path of paths) {
    urgent.delete(path);
    pending.delete(path);
  }
  if (urgent.size + pending.size > 0) scheduled = setTimeout(flush, BATCH_MS);
  if (paths.length === 0) return;

  let answered = false;
  invoke<{ path: string; title: string; summary?: string | null; icon?: string | null }[]>("meta", {
    paths,
  })
    .then((rows) => {
      answered = true;
      for (const row of rows) {
        metaCache.set(row.path, {
          title: row.title,
          summary: row.summary ?? "",
          icon: row.icon ?? null,
        });
      }
    })
    .catch(() => {})
    .finally(() => {
      // Anything an answer did not name has no page in this build. A failed
      // call proves nothing, so it is not cached. Both must still be
      // resolved: the skeleton has no terminal state, so a silent return
      // leaves it loading forever.
      for (const path of paths) {
        if (answered && !metaCache.has(path)) metaCache.set(path, null);
        const entry = metaCache.get(path);
        for (const resolve of waiting.get(path) ?? []) resolve(entry);
        waiting.delete(path);
      }
    });
}

/** `eager` is a reader pointing at the link right now. Everything else — a
    link merely on screen, waiting to draw its icon — goes behind that, or a
    shelf page of a thousand links puts a thousand slugs in front of the one
    hover that matters. */
/** What is known of a page with no call: the cache, or the title list in
    memory, which holds what a call would answer for almost every page. */
function known(slug: string): MetaEntry | null | undefined {
  if (!metaCache.has(slug)) {
    const hit = hitOf(slug);
    if (hit) metaCache.set(slug, { title: hit.title, summary: hit.summary ?? "", icon: hit.icon ?? null });
  }
  return metaCache.get(slug);
}

function request(
  slug: string,
  onSettled?: (entry: Settled) => void,
  eager = true,
) {
  // On an index page of two thousand links, the calls held the database lock,
  // and the next page read waited half a second behind them.
  known(slug);
  if (metaCache.has(slug)) {
    onSettled?.(metaCache.get(slug) ?? null);
    return;
  }
  if (onSettled) {
    let set = waiting.get(slug);
    if (!set) waiting.set(slug, (set = new Set()));
    set.add(onSettled);
  }
  if (eager && onSettled) urgent.add(slug);
  else pending.add(slug);
  scheduled ??= setTimeout(flush, BATCH_MS);
}

/** Warms the cache for a link that has scrolled into view, so its tooltip is
 *  already written by the time the reader points at it. */
export function registerSlug(slug: string) {
  request(slug);
}

/** What a page is called and what it looks like, once the batch has answered.
    Null until then, so a link shows what the help wrote and swaps to the page's
    own name when the answer arrives. */
export function usePageMark(slug: string | null): MetaEntry | null {
  // The title list in memory already names the page's icon, so a link draws
  // its own mark at once instead of the page glyph, then the icon.
  const [mark, setMark] = useState<MetaEntry | null>(() => (slug ? (known(slug) ?? null) : null));
  useEffect(() => {
    if (!slug) return;
    let live = true;
    request(
      slug,
      (entry) => {
        if (live) setMark(entry ?? null);
      },
      false,
    );
    return () => {
      live = false;
    };
  }, [slug]);
  return mark;
}

interface Anchored {
  anchorRef: React.RefObject<HTMLElement | null>;
  hoverPosRef?: React.RefObject<{ x: number; y: number } | null>;
  /** `right` is for a row of the sidebar: it opens past the panel's edge, so
      it hides none of the rows the reader may scroll to. */
  side?: "above" | "right";
}

/** The box every tooltip sits in. Fixed, so it escapes any ancestor's
    `overflow: clip` (e.g. the carousel). Over the link, or under it where the
    box does not fit above, and pushed in from the side of the window. */
export function TooltipBox({ anchorRef, hoverPosRef, side = "above", className, children }: Anchored & { className: string; children: React.ReactNode }) {
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [line, setLine] = useState<DOMRect | null>(null);
  const [place, setPlace] = useState({ x: 0, below: false });
  // The top of a box on the right, kept inside the window.
  const [top, setTop] = useState(0);

  useLayoutEffect(() => {
    const anchorEl = anchorRef.current;
    if (!anchorEl) return;
    // Card-grid links use a "stretched link" ::after overlay (globals.css) so the
    // whole card is clickable — the <a> itself is only the title text. Anchoring
    // to the <a>'s own rect centers the tooltip on that title, well off-center
    // from the visually-clickable card, so anchor to the card instead.
    if (side === "right") {
      const rect = anchorEl.getBoundingClientRect();
      const edge = anchorEl.closest("aside")?.getBoundingClientRect().right ?? rect.right;
      setLine(new DOMRect(rect.x, rect.y, edge - rect.x, rect.height));
      return;
    }
    const card = anchorEl.closest<HTMLElement>(".shelf-grid li");
    if (card) {
      setLine(card.getBoundingClientRect());
      return;
    }
    // getBoundingClientRect() on a wrapped link returns the union of every
    // line's box — its horizontal center can float over blank space between
    // lines, nowhere near the line the cursor is actually on. getClientRects()
    // gives one rect per visual line, so pick the one the pointer entered on.
    const rects = anchorEl.getClientRects();
    const hoverPos = hoverPosRef?.current;
    let rect = rects[0] ?? anchorEl.getBoundingClientRect();
    if (hoverPos) {
      for (const r of rects) {
        if (hoverPos.y >= r.top && hoverPos.y <= r.bottom) {
          rect = r;
          break;
        }
      }
    }
    setLine(rect);
  }, [anchorRef, hoverPosRef, side]);

  // After every render, because the content grows when its answer arrives.
  // An unchanged place returns the same object, so this settles in one pass.
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (!el || !line) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    if (side === "right") {
      const want = Math.round(line.top + line.height / 2 - height / 2);
      const next = Math.max(margin, Math.min(want, window.innerHeight - margin - height));
      setTop((t) => (Math.abs(t - next) < 1 ? t : next));
      return;
    }
    const left = line.left + line.width / 2 - width / 2;
    const x =
      left < margin ? margin - left : left + width > window.innerWidth - margin ? window.innerWidth - margin - (left + width) : 0;
    const below = line.top - 4 - height < margin && line.bottom + 4 + height <= window.innerHeight - margin;
    // Whole pixels, and a change under one is no change: a scale on the box
    // makes the measured width jitter in the fifth decimal, and an exact
    // compare set the state on every render until React gave up (#185).
    const shift = Math.round(x);
    setPlace((p) => (Math.abs(p.x - shift) < 1 && p.below === below ? p : { x: shift, below }));
  });

  // A tooltip comes at once and goes slowly: the reader waits for the first,
  // and the second only must not blink. The owner has already dropped the box
  // when it goes, so a copy of it fades in its place. A new tooltip ends the
  // fade at once, or the old box shows from under the new one.
  useLayoutEffect(() => {
    for (const ghost of document.querySelectorAll("[data-tooltip-ghost]")) ghost.remove();
    return () => {
      const el = tooltipRef.current;
      if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const ghost = el.cloneNode(true) as HTMLElement;
      ghost.classList.add("pop-out");
      ghost.setAttribute("data-tooltip-ghost", "");
      document.body.append(ghost);
      setTimeout(() => ghost.remove(), 200);
    };
  }, []);

  if (!line) return null;

  return createPortal(
    <span
      ref={tooltipRef}
      style={
        side === "right"
          ? { top, left: line.right + 8 }
          : {
              top: place.below ? line.bottom + 4 : line.top - 4,
              left: line.left + line.width / 2,
              transform: `translate(calc(-50% + ${place.x}px), ${place.below ? "0" : "-100%"})`,
            }
      }
      className={cn(
        "[@media(hover:none)]:hidden rounded-lg fixed z-50 bg-background border border-border shadow-lg p-2 text-xs pointer-events-none whitespace-normal [overflow-wrap:anywhere]",
        className,
      )}
    >
      {children}
    </span>,
    document.body,
  );
}

/** What a page in the help is called and what it is about. */
export function DocTooltip({ slug, summaryOnly = false, ...anchored }: Anchored & { slug: string; summaryOnly?: boolean }) {
  // undefined while the answer is on its way; null for a page the build does
  // not have.
  const [meta, setMeta] = useState<MetaEntry | null | undefined>(() => known(slug));
  const [failed, setFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // The same 75ms the site waited: a cursor crossing a line of links must not
    // ask about every one of them on the way past.
    const debounce = setTimeout(() => {
      request(slug, (entry) => {
        if (!mountedRef.current) return;
        if (entry === undefined) setFailed(true);
        else setMeta(entry);
      });
    }, 75);

    return () => {
      mountedRef.current = false;
      clearTimeout(debounce);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return null;

  const summary = meta?.summary;
  if (summaryOnly && !summary) return null;

  return (
    <TooltipBox {...anchored} className="w-max max-w-[16rem]">
      {meta ? (
        <>
          <span className="block font-semibold text-foreground">{meta.title}</span>
          {summary && <span className="text-muted-foreground mt-0.5 line-clamp-2">{summary}</span>}
        </>
      ) : meta === null ? (
        // The help itself links to pages that do not exist. Say so, so the
        // reader does not blame the app for the empty page behind the link.
        <>
          <span className="block font-semibold text-foreground">Broken link</span>
          <span className="text-muted-foreground mt-0.5">
            The SideFX docs link to a page that is not in this Houdini build.
          </span>
        </>
      ) : (
        <Skeleton />
      )}
    </TooltipBox>
  );
}

/** The page tooltip of a row in a list: it opens when the pointer arrives and
    goes on a press. The row already shows the name, so a page with no summary
    gets no tooltip. Spread `pointer` on the link and render
    `tip` beside it — not in it: a link sets its ref after the layout effects of
    its children, so a box inside it measures nothing. */
export function useRowTip<T extends HTMLElement>(slug: string, side: Anchored["side"]) {
  const anchorRef = useRef<T>(null);
  const [shown, setShown] = useState(false);
  return {
    anchorRef,
    pointer: {
      onPointerEnter: () => setShown(true),
      onPointerLeave: () => setShown(false),
      // A press is the answer to the question the tooltip was for.
      onPointerDown: () => setShown(false),
    },
    tip: shown ? <DocTooltip slug={slug} anchorRef={anchorRef} side={side} summaryOnly /> : null,
  };
}

function Skeleton() {
  return (
    <>
      <span className="sk block h-3 w-28 rounded-lg bg-muted" />
      <span className="sk block h-2.5 w-40 rounded-lg bg-muted mt-1.5" />
    </>
  );
}

interface LinkPreview {
  title?: string | null;
  description?: string | null;
  image?: string | null;
}

// One ask per address for the whole session. A failure is kept as null, so an
// address that does not answer is not asked again on every hover.
const previews = new Map<string, Promise<LinkPreview | null>>();
/** The answers that are in, so a warmed card draws on the first frame. */
const settled = new Map<string, LinkPreview | null>();
/** Pictures fetched ahead. Held, or the webview can drop them again. */
const pictures = new Map<string, HTMLImageElement>();

/** Asks for the share card of `url`, and fetches its picture. A link calls
    it once it scrolls into view, so the tooltip opens with the card in it. */
export function warmPreview(url: string) {
  let asked = previews.get(url);
  if (!asked) {
    asked = invoke<LinkPreview>("link_preview", { url })
      .catch(() => null)
      .then((answer) => {
        settled.set(url, answer);
        const image = answer?.image;
        if (image && !pictures.has(image)) {
          const picture = new Image();
          picture.referrerPolicy = "no-referrer";
          picture.src = image;
          pictures.set(image, picture);
        }
        return answer;
      });
    previews.set(url, asked);
  }
  return asked;
}

/** "sidefx.com/docs/houdini", not the whole address: the reader wants to
    know where the link goes, and the scheme and the query say little. */
function where(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname.replace(/^www\./, "") + pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** The share card of a link that leaves the help: its picture, title and
    description, and where it goes. With no network, or a site that gives no
    card, it is the address alone — still more than the link text says. */
export function LinkTooltip({ url, ...anchored }: Anchored & { url: string }) {
  // undefined while the answer is on its way.
  const [card, setCard] = useState<LinkPreview | null | undefined>(() => settled.get(url));
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (settled.has(url)) return setCard(settled.get(url));
    let live = true;
    // The same 75ms as a page link: a cursor crossing a line of links must not
    // ask about every one of them on the way past.
    const debounce = setTimeout(() => {
      void warmPreview(url).then((answer) => {
        if (live) setCard(answer);
      });
    }, 75);
    return () => {
      live = false;
      clearTimeout(debounce);
    };
  }, [url]);

  const image = card?.image && !broken ? card.image : null;

  return (
    <TooltipBox {...anchored} className="w-72">
      {card === undefined ? (
        <Skeleton />
      ) : (
        <>
          {/* The share-card ratio, held before the picture arrives, so the
              box does not grow under the reader when it loads. Contained,
              not cropped: many sites give a square logo, not a banner. */}
          {image && (
            <img
              src={image}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setBroken(true)}
              className="mb-2 block aspect-[1.91/1] w-full rounded-md bg-muted object-contain"
            />
          )}
          {card?.title && <span className="font-semibold text-foreground line-clamp-2">{card.title}</span>}
          {card?.description && (
            <span className="text-muted-foreground mt-0.5 line-clamp-3">{card.description}</span>
          )}
        </>
      )}
      <span className={cn("flex items-center gap-1 text-muted-foreground", card?.title && "mt-1.5")}>
        <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{where(url)}</span>
      </span>
    </TooltipBox>
  );
}

const HEADING = /^H([1-6])$/;

/** The words of the section an anchor lands on, read off the page on screen.
    A heading owns what follows it down to the next heading of its rank or
    above; a parameter row owns its own cells. */
function section(id: string): { title: string; text: string } | null {
  const target = document.getElementById(id);
  if (!target) return null;
  const words = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const block = target.closest<HTMLElement>("h1,h2,h3,h4,h5,h6,dt,tr,li,p") ?? target;
  if (block.tagName === "TR") {
    const [head, ...rest] = [...block.children];
    return { title: words(head), text: rest.map(words).join(" ") };
  }
  const level = Number(HEADING.exec(block.tagName)?.[1] ?? 0);
  let text = "";
  if (level || block.tagName === "DT") {
    for (let el = block.nextElementSibling; el && text.length < 400; el = el.nextElementSibling) {
      const rank = Number(HEADING.exec(el.tagName)?.[1] ?? 7);
      if (rank <= (level || 6) || (block.tagName === "DT" && el.tagName === "DT")) break;
      text += ` ${words(el)}`;
    }
  }
  const title = words(block);
  return title || text ? { title, text: text.trim() } : null;
}

/** What is at an anchor on the open page, so the reader need not jump there
    and back to find out. */
export function SectionTooltip({ id, ...anchored }: Anchored & { id: string }) {
  // Read once, when the pointer arrives: the page does not change under it.
  const [found] = useState(() => section(id));
  if (!found) return null;
  return (
    <TooltipBox {...anchored} className="w-max max-w-[20rem]">
      {found.title && <span className="font-semibold text-foreground line-clamp-2">{found.title}</span>}
      {found.text && <span className="text-muted-foreground mt-0.5 line-clamp-4">{found.text}</span>}
    </TooltipBox>
  );
}
