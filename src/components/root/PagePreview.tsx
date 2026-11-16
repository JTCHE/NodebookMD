/**
 * The top of a real page, drawn small: the same title, summary and first
 * blocks the reader saw, laid out at a page width and scaled to fit its box.
 * Inert: it is a picture of the page, and the card around it is the link.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageTitle } from "@/components/docs/PageTitle";
import { Body } from "@/components/docs/markdown/Body";
import { markdownComponents } from "@/components/docs/markdown";
import { known, read, type PageView } from "@/lib/pages";
import { pageKind } from "@/lib/ranking";

/** The page is drawn at this fraction of its size, the same in every window
    width, so a wider card shows more of the page and never bigger type. */
const SCALE = 0.75;
/** Enough blocks to fill the window; the rest is never seen. */
const BLOCKS = 8;

/** True when the block is, or wraps, a code block or a code panel (a VEX or HOM signature). */
function holdsCode(node: { type: string; tagName?: string; properties?: { className?: unknown }; children?: unknown[] }): boolean {
  if (node.tagName === "pre") return true;
  const classes = node.properties?.className;
  if (Array.isArray(classes) && classes.some((name) => String(name).includes("code-panel") || String(name).includes("vex-signature"))) return true;
  return (node.children ?? []).some((child) => holdsCode(child as typeof node));
}

/** A picture of page content: laid out at a page width, drawn at one scale,
    faded at its foot. The home cards and the link tooltips both draw in it.
    One scale for both, so a page reads the same in each. */
export function PreviewFrame({ children }: { children: React.ReactNode }) {
  const scale = SCALE;
  // The page is laid out as wide as the window, divided by the scale. A
  // percentage width resolves against the zoomed box and overflows it.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth / scale));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The fade is set here, not inherited: the list around the cards turns its own fade off at its ends.
  return (
    <div ref={box} inert aria-hidden="true" className="fade-out pointer-events-none absolute inset-0 overflow-clip select-none [--fade-above:0] [--fade-below:1] [--fade-size:32px]">
      <article
        className="prose prose-neutral dark:prose-invert max-w-none px-[calc(var(--spacing-ms)/var(--scale))] pt-[calc(var(--spacing-ms)/var(--scale))] lg:px-[calc(var(--spacing-md)/var(--scale))] lg:pt-[calc(var(--spacing-md)/var(--scale))]"
        style={{ width: width || undefined, zoom: scale, "--scale": scale } as React.CSSProperties}
      >
        {children}
      </article>
    </div>
  );
}

export function PagePreview({ path, title }: { path: string; title: string }) {
  const [page, setPage] = useState<PageView | undefined>(() => known(path));

  useEffect(() => {
    if (page?.tree) return;
    let live = true;
    read(path).then((view) => live && setPage(view), () => {});
    return () => {
      live = false;
    };
  }, [path, page]);

  // The window skips code panels: a dark slab under the foot fade reads as a
  // smear, and the prose around it says what the page is.
  const blocks = page?.tree?.children.filter((block) => !holdsCode(block)).slice(0, BLOCKS) ?? [];
  const tree = page?.tree && { ...page.tree, children: blocks };
  return (
    <PreviewFrame>
        {/* The page's own breadcrumb line, so the window reads as the top of a page. */}
        <p className="m-0 mb-4 text-xs text-muted-foreground">{path.split("/").slice(0, -1).join("  ›  ")}</p>
        <div className="not-prose">
          <PageTitle name={page?.name ?? title} nodeType={pageKind(path, page?.nodeType)} icon={page?.icon} />
        </div>
        {page?.summary && <p className="m-0 mt-3 text-sm text-muted-foreground">{page.summary}</p>}
        {tree && <Body tree={tree} components={markdownComponents} whole />}
    </PreviewFrame>
  );
}
