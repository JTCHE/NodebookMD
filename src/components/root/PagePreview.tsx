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

/** The width the page is laid out at before it is scaled down. */
const PAGE_WIDTH = 440;
/** Enough blocks to fill the window; the rest is never seen. */
const BLOCKS = 8;

export function PagePreview({ path, title }: { path: string; title: string }) {
  const [page, setPage] = useState<PageView | undefined>(() => known(path));
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);

  useEffect(() => {
    if (page?.tree) return;
    let live = true;
    read(path).then((view) => live && setPage(view), () => {});
    return () => {
      live = false;
    };
  }, [path, page]);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScale(element.clientWidth / PAGE_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const tree = page?.tree && { ...page.tree, children: page.tree.children.slice(0, BLOCKS) };
  return (
    <div ref={box} inert aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <article
        className="prose prose-neutral dark:prose-invert max-w-none origin-top-left px-[24px] pt-[20px]"
        style={{ width: PAGE_WIDTH, zoom: scale }}
      >
        <PageTitle name={page?.name ?? title} nodeType={pageKind(path, page?.nodeType)} icon={page?.icon} />
        {page?.summary && <p className="m-0 mt-3 text-sm text-muted-foreground">{page.summary}</p>}
        {tree && <Body tree={tree} components={markdownComponents} whole />}
      </article>
    </div>
  );
}
