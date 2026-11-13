import { useEffect, useState } from "react";
import type { Heading } from "@/lib/markdown/headings";
import { revealDetails } from "@/lib/ui/disclosure";

/**
 * The element that actually scrolls. AppShell pins the window at h-dvh with
 * overflow-hidden — the window itself never scrolls — so every scroll
 * position, listener, and jump target in this file has to go through this
 * element, not `window`.
 */
export function scroller() {
  return document.querySelector<HTMLElement>(".docs-shell");
}

/**
 * Distance from the top of the scroller to the first readable line: the
 * page's bar, which stays at the top of the scroller, and the floating pill
 * under it where the pill exists. The title bar sits above the scroller, not
 * over its content, so it needs no offset here.
 */
export function readingLine() {
  // The same measure and breakpoint the gutter list is switched on: the
  // scroller's width, not the window's. Below it the pill is there too.
  const box = scroller();
  const bar = box ? parseFloat(getComputedStyle(box).getPropertyValue("--page-bar-h")) * 16 || 0 : 0;
  return bar + ((box?.clientWidth ?? window.innerWidth) >= 780 ? 24 : 64);
}

/**
 * The headings themselves, in document order — index-aligned with what
 * extractHeadings returned (a unit test locks that pairing).
 *
 * Addressed by position, never by id: SideFX ships pages carrying the same
 * anchor id on several headings ("Control settings" under Disturbance,
 * Shredding and Turbulence), and getElementById only ever finds the first, so
 * an id is neither a unique key nor a usable handle here.
 */
export function headingEls() {
  return document.querySelectorAll<HTMLElement>("article :is(h2,h3,h4,h5,h6)[id]");
}

/**
 * `el`'s position expressed as a `scroller().scrollTop` value: the scrollTop
 * that would put `el`'s top at `box`'s own top edge. Both rects come from
 * getBoundingClientRect, so they are viewport-relative the same way, and
 * whatever sits above `box` (the title bar) cancels out of the subtraction —
 * no header height to add back in.
 */
export function scrollTopFor(el: HTMLElement, box: HTMLElement) {
  return el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
}

/**
 * The element an anchor names. The page's own `#id:` anchor first: a heading
 * slug made from the text can be the same word as a parameter name (a
 * "Locomotion" folder over a `locomotion` parameter), and F1 asks for the
 * parameter.
 */
export function findAnchor(id: string) {
  return document.querySelector<HTMLElement>(`span[id="${CSS.escape(id)}"]`) ?? document.getElementById(id);
}

/**
 * Put `el` on the first readable line, clear of the page bar and the pill.
 * A jump, not a smooth scroll: the reader asked for that place, and the
 * travel only delays it.
 */
export function jumpTo(el: HTMLElement) {
  revealDetails(el);
  const box = scroller();
  if (box) box.scrollTo({ top: scrollTopFor(el, box) - readingLine() - stickyAbove(el) });
}

/**
 * The height of a bar that stays at the top of `el`'s section (the methods
 * filter), so a jump lands under it too.
 */
function stickyAbove(el: HTMLElement) {
  for (let group = el.closest(".section-group"); group; group = group.parentElement?.closest(".section-group") ?? null) {
    const bar = group.querySelector<HTMLElement>(":scope > .sticky");
    if (bar && bar !== el && !bar.contains(el)) return bar.offsetHeight;
  }
  return 0;
}

/**
 * The row the reader last pressed, and the scroll position the jump left.
 * A heading near the end of a page cannot reach the reading line, so the
 * position alone would name an earlier one. Until the page moves again, the
 * row the reader asked for is the answer.
 */
let pressed: { index: number; top: number } | null = null;

/** Jump to a heading from the list of contents. */
export function scrollToHeading(e: React.MouseEvent, index: number, id: string) {
  const el = headingEls()[index];
  if (!el || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  jumpTo(el);
  const box = scroller();
  if (box) {
    pressed = { index, top: box.scrollTop };
    // At the bottom of the page the jump does not move it, and no scroll
    // ends to ask for the answer. Ask anyway.
    box.dispatchEvent(new Event("scrollend"));
  }
  // Keep the router's state: its `idx` is what says whether back leads anywhere.
  history.replaceState(history.state, "", `#${id}`);
}

/**
 * The last heading at or above the reading line, found from where the
 * headings are now. Headings sit in document order, so a binary search reads
 * a handful of rects, not all of them. At the bottom of the page the line
 * drops to the bottom edge: the last sections can never climb higher.
 */
function activeAt(box: HTMLElement, els: NodeListOf<HTMLElement>) {
  if (pressed && Math.abs(box.scrollTop - pressed.top) < 1 && pressed.index < els.length) return pressed.index;
  pressed = null;
  const bounds = box.getBoundingClientRect();
  const atBottom = box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
  const line = atBottom ? bounds.bottom : bounds.top + readingLine() + 8;
  let found: number | undefined;
  let low = 0;
  let high = els.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (els[middle].getBoundingClientRect().top <= line) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** Position of the heading the reader is under, or nothing above the first one. */
export function useActiveIndex(headings: Heading[]) {
  const [active, setActive] = useState<number>();
  // Nothing is under the reader on a page they have not scrolled yet. The
  // observer below says so a frame later, which is a frame of the last page's
  // row marked on this one's list.
  const [drawn, setDrawn] = useState(headings);
  if (drawn !== headings) {
    setDrawn(headings);
    setActive(undefined);
  }

  useEffect(() => {
    const box = scroller();
    if (!box) return;
    pressed = null;
    // Reading every heading on every scroll made the index page lay out ten
    // thousand nodes again. So nothing is read while the page moves: a
    // heading crossing the line, or the end of a scroll, asks for the answer
    // again, from scratch. A jump crosses many headings and reports only
    // some of them, so the answer is never built up from the crossings.
    // The body is drawn a slice at a time, so the headings are looked up on
    // each answer, and the ones drawn since the last are watched too.
    const update = () => {
      const els = headingEls();
      for (const el of els) observer.observe(el);
      setActive(activeAt(box, els));
    };
    const observer = new IntersectionObserver(update, {
      root: box,
      rootMargin: `-${readingLine() + 8}px 0px 0px 0px`,
      threshold: 0,
    });
    update();
    box.addEventListener("scrollend", update);
    return () => {
      observer.disconnect();
      box.removeEventListener("scrollend", update);
    };
  }, [headings]);

  return active;
}
