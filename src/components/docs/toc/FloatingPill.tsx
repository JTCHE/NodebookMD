"use client";

import { ChevronDown, List } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Heading } from "@/lib/markdown/headings";
import { TocList } from "./TocList";

/**
 * The floating pill, top left, once the inline list has scrolled away: the
 * button names the section you are under, and opens a panel of every heading.
 *
 * The pill's left edge sits a padding-width outside the page column so its
 * content lines up on the same vertical axis as everything else on the page —
 * the negative margin is that alignment, not a nudge.
 */
export function FloatingPill({
  headings,
  top,
  active,
  floating,
}: {
  headings: Heading[];
  /** Level of the shallowest heading on the page — depth 0 is measured from it. */
  top: number;
  /** Position of the active heading, not its id — ids repeat. */
  active?: number;
  /** True once the inline list has scrolled out of view; the pill fades in. */
  floating: boolean;
}) {
  const floater = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // The panel is open only while both are true, so scrolling back to the
  // inline list closes it without an effect — TableOfContents owns the one
  // intersection observer that drives `floating`.
  const expanded = open && floating;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!floater.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Open onto the section you are reading: on a long page the active row is
  // usually far below the fold. scrollTop rather than scrollIntoView, which
  // scrolls the ancestors too and would drag the article out from under you.
  useEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    const row = el.querySelector<HTMLElement>("[aria-current]");
    // Rows are static children of an absolutely positioned panel, so offsetTop
    // is already measured against it.
    if (row) el.scrollTop = row.offsetTop - el.clientHeight / 2 + row.offsetHeight / 2;
  }, [open, active]);

  // The negative margin cancels the pill's border and left padding (1px +
  // pl-3.5), putting the icon on the page's shared vertical axis.
  const pillAlign = "-ml-[15px] pl-3.5 pr-3";

  return (
    <div
      ref={floater}
      // Sticky in the reading column, not fixed to the window: the window has
      // a panel down its left side, and a pill fixed to the window centres
      // itself over that panel instead of over the page. The wrapper carries
      // no height, so it lies over the text rather than pushing it down.
      // It rides just under the page's bar, which stays at the top.
      className={`print:hidden @min-toc:hidden sticky top-[calc(var(--page-bar-h)+0.5rem)] z-20 h-0 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
        floating ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {/* Already inside the article, so the column's padding is not added
          again here. */}
      <div className="flex">
        <div className="relative">
          <button
            type="button"
            onClick={(() => setOpen((v) => !v))}
            aria-expanded={expanded}
            aria-label="Table of contents"
            className={`relative inline-flex max-w-[min(20rem,calc(100vw-3rem))] items-center gap-2 h-10 ${pillAlign} text-sm font-medium text-foreground bg-background border border-border rounded-full shadow-lg shadow-black/10 transition-colors hover:bg-accent active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-interactive`}
          >
            <List className="size-4 shrink-0 text-muted-foreground" />
            {/* Keyed on the section, so each new title animates in on its own. */}
            <span key={active ?? "none"} className="toc-label truncate">
              {(active === undefined ? undefined : headings[active]?.text) ?? "On this page"}
            </span>
            <ChevronDown
              className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>

          <div
            ref={panel}
            // svh, not vh or dvh: 100vh on iOS means the viewport with the
            // address bar hidden, so a panel sized against it runs off the
            // bottom of the screen under Safari's bottom bar. svh is the
            // smallest state — the panel fits with every bar on screen.
            style={{ maxHeight: "calc(100svh - var(--spacing-titlebar) - 6rem)" }}
            className={`-ml-[15px] absolute left-0 top-full mt-2 w-[min(20rem,calc(100vw-3rem))] overflow-y-auto overscroll-contain border border-border bg-background rounded-2xl shadow-xl shadow-black/20 p-1.5 origin-top-left transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${expanded ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.98]"}`}
          >
            <TocList headings={headings} top={top} active={active} padded onNavigate={() => setOpen(false)} />
          </div>
        </div>
      </div>
    </div>
  );
}

