/**
 * Collapsible sections, one per h2–h4 heading.
 *
 * The rehype sections pass wraps the content a heading owns in
 * `[data-section]`, right after the heading. The heading's toggle button
 * hides that div. A collapsed state survives navigation for the session; an
 * anchor, a search hit or a find match inside a closed section opens it
 * first, so nothing is unreachable. See markdown/rehype-sections.ts.
 */

const collapsed = new Set<string>();

const key = (path: string, id: string) => `${path}#${id}`;

export function sectionKey(path: string, id: string): string {
  return key(path, id);
}

/** The div that holds the content the heading collapses, if it owns any. */
export function sectionOf(heading: Element): HTMLElement | null {
  const next = heading.nextElementSibling;
  return next?.matches("[data-section]") ? (next as HTMLElement) : null;
}

export function isCollapsed(headingKey: string): boolean {
  return collapsed.has(headingKey);
}

/** Hides or shows the section under the heading. False when the heading owns
    no content, so the caller keeps its state. */
export function setCollapsed(heading: HTMLElement, headingKey: string, value: boolean): boolean {
  const section = sectionOf(heading);
  if (!section) return false;
  section.hidden = value;
  heading.toggleAttribute("data-collapsed", value);
  if (value) collapsed.add(headingKey);
  else collapsed.delete(headingKey);
  return true;
}

/** Opens every collapsed section the element sits in, from the innermost
    out. Also forgets the saved state, so a later re-render keeps it open. */
export function revealSections(element: Element | null) {
  for (
    let node = element?.closest("[data-section]");
    node;
    node = node.parentElement?.closest("[data-section]") ?? null
  ) {
    if (!(node as HTMLElement).hidden) continue;
    (node as HTMLElement).hidden = false;
    node.previousElementSibling?.removeAttribute("data-collapsed");
    const id = node.getAttribute("data-section");
    if (id) for (const saved of collapsed) if (saved.endsWith(`#${id}`)) collapsed.delete(saved);
  }
}

function scrollerOf(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
  }
  return null;
}

/**
 * Runs a change that resizes the page, and keeps `anchor` at the same height
 * on screen. When the page gets too short to keep it there, blank room at the
 * end holds the scroll position. The room
 * goes as the reader scrolls up, so the page never scrolls past its own end.
 */
const spare = new WeakMap<HTMLElement, number>();

export function keepInPlace(anchor: Element, change: () => void) {
  const scroller = scrollerOf(anchor);
  if (!scroller) {
    change();
    return;
  }
  const before = anchor.getBoundingClientRect().top;
  change();
  const wanted = scroller.scrollTop + anchor.getBoundingClientRect().top - before;
  const held = spare.get(scroller) ?? 0;
  const reach = scroller.scrollHeight - held - scroller.clientHeight;
  const room = Math.max(0, wanted - reach);
  hold(scroller, reach + scroller.clientHeight, room);
  if (room > 0 && !held) {
    // Each scroll up gives back the room under the view's bottom edge.
    const shrink = () => {
      const current = spare.get(scroller) ?? 0;
      const natural = scroller.scrollHeight - current;
      const needed = Math.max(0, scroller.scrollTop + scroller.clientHeight - natural);
      if (needed < current) hold(scroller, natural, needed);
      if (needed === 0) scroller.removeEventListener("scroll", shrink);
    };
    scroller.addEventListener("scroll", shrink, { passive: true });
  }
  scroller.scrollTop = wanted;
}

/** The page's content overflows the scroller's child, so padding or an
    element at the end would not add room. The child's min-height does. */
function hold(scroller: HTMLElement, natural: number, room: number) {
  const body = scroller.firstElementChild as HTMLElement | null;
  if (!body) return;
  spare.set(scroller, room);
  body.style.minHeight = room ? `${natural + room}px` : "";
}

/** Opens every details and collapsed section the element sits in. */
export function revealDetails(element: Element | null) {
  for (let detail = element?.closest("details"); detail; detail = detail.parentElement?.closest("details")) {
    detail.open = true;
  }
  revealSections(element);
}
