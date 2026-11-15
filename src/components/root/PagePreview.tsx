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
const SCALE = 0.42;
/** The page's own side padding, before the scale. */
const PAGE_PADDING = 24;
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
    <div ref={box} inert aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <article
        className="prose prose-neutral dark:prose-invert max-w-none pt-[20px]"
        style={{ width: width || undefined, zoom: SCALE, paddingInline: PAGE_PADDING }}
      >
        <PageTitle name={page?.name ?? title} nodeType={pageKind(path, page?.nodeType)} icon={page?.icon} />
        {page?.summary && <p className="m-0 mt-3 text-sm text-muted-foreground">{page.summary}</p>}
        {tree ? (
          <Body tree={tree} components={markdownComponents} whole />
        ) : (
          // While the page loads: the shape of a summary and a first paragraph.
          <div className="mt-5 flex flex-col gap-3">
            {["w-4/5", "w-full", "w-11/12", "w-3/5"].map((width) => (
              <div key={width} className={`h-3 rounded-sm bg-neutral-100 ${width}`} />
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
