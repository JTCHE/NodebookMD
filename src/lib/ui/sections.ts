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
