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
const SCALE = 0.42; // also in the padding classes below: text inside sits on the search text axis
/** Enough blocks to fill the window; the rest is never seen. */
const BLOCKS = 8;

export function PagePreview({ path, title }: { path: string; title: string }) {
  const [page, setPage] = useState<PageView | undefined>(() => known(path));

  // The page is laid out as wide as the window, divided by the scale. A
  // percentage width resolves against the zoomed box and overflows it.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth / SCALE));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (page?.tree) return;
    let live = true;
    read(path).then((view) => live && setPage(view), () => {});
    return () => {
      live = false;
    };
  }, [path, page]);

  const tree = page?.tree && { ...page.tree, children: page.tree.children.slice(0, BLOCKS) };
  return (
    <div ref={box} inert aria-hidden="true" className="fade-out pointer-events-none absolute inset-0 overflow-hidden select-none [--fade-size:32px]">
      <article
        className="prose prose-neutral dark:prose-invert max-w-none px-[calc(var(--spacing-ms)/0.42)] pt-[calc(var(--spacing-ms)/0.42)] lg:px-[calc(var(--spacing-md)/0.42)] lg:pt-[calc(var(--spacing-md)/0.42)]"
        style={{ width: width || undefined, zoom: SCALE }}
      >
        {/* The page's own breadcrumb line, so the window reads as the top of a page. */}
        <p className="m-0 mb-4 text-xs text-muted-foreground">{path.split("/").slice(0, -1).join("  ›  ")}</p>
        <div className="not-prose">
          <PageTitle name={page?.name ?? title} nodeType={pageKind(path, page?.nodeType)} icon={page?.icon} />
        </div>
        {page?.summary && <p className="m-0 mt-3 text-sm text-muted-foreground">{page.summary}</p>}
        {tree && <Body tree={tree} components={markdownComponents} whole />}
      </article>
    </div>
  );
}
