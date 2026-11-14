/**
 * The method filter of a class page. The find bar runs it: with the filter
 * on, the words in the bar also hide every method row that does not match.
 *
 * The rows come from the parser (`rehype-hom`), in one `.hom-methods` box
 * that holds the class's own methods and the inherited ones. This works on
 * the page's DOM: it hides what does not match and puts nothing new in it.
 */
import { revealSections } from "@/lib/ui/sections";

/** `num_components`, `numComponents` and `NumComponents` match each other. */
const fold = (value: string) => value.toLowerCase().replace(/[_\s]/g, "");

/** The row the filter opened because it was the only match. The filter
    closes it again when the words change; a row the reader opened stays. */
let opened: HTMLDetailsElement | null = null;

/** The box of methods on the page, or nothing on a page without one. */
export function methodsBox(root: ParentNode = document) {
  return root.querySelector<HTMLElement>(".hom-methods");
}

/** Shows only the methods whose name or caption holds `query`. An empty
    query shows them all. */
export function filterMethods(box: HTMLElement, query: string) {
  const rows = [...box.querySelectorAll<HTMLElement>(".hom-method[data-name]")];
  // The name first; the caption too, so "label" finds what returns one.
  const matches = (row: HTMLElement, words: string) => fold(row.dataset.name ?? "").includes(words) || fold(row.querySelector(".hom-method-caption")?.textContent ?? "").includes(words);
  // Words that match no method hide nothing: an empty list would shorten the
  // page and make it jump, and tell the reader no more than the 0/0 count.
  const typed = fold(query);
  const wanted = rows.some((row) => matches(row, typed)) ? typed : "";
  // The view holds still: the first row on screen keeps its place, or, when
  // the filter hides it, the next row it leaves.
  let scroller = box.parentElement;
  while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  const viewTop = scroller?.getBoundingClientRect().top ?? 0;
  const anchorIndex = rows.findIndex((row) => !row.hidden && row.getBoundingClientRect().bottom > viewTop);
  const anchorTop = anchorIndex < 0 ? 0 : rows[anchorIndex].getBoundingClientRect().top;
  // While a filter is on, the box keeps the height it had, so the page
  // never gets too short to hold its scroll position.
  box.style.minHeight = wanted ? `${Math.max(parseFloat(box.style.minHeight) || 0, box.getBoundingClientRect().height)}px` : "";
  let only: HTMLElement | null = null;
  let shown = 0;
  for (const row of rows) {
    const match = !wanted || matches(row, wanted);
    row.hidden = !match;
    if (!match) continue;
    shown += 1;
    only = row;
    // A match in a section the reader closed is still a match: show it.
    if (wanted) revealSections(row);
  }
  // A group with no row left goes, and its heading with it. A mark, not
  // `hidden`: `hidden` is the reader's own collapse, and clearing the
  // filter must not open what they closed.
  for (const group of box.querySelectorAll<HTMLElement>(".section-group")) {
    if (!group.querySelector(".hom-method[data-name]")) continue;
    const empty = !group.querySelector(".hom-method[data-name]:not([hidden])");
    group.toggleAttribute("data-no-match", empty);
    const heading = group.previousElementSibling as HTMLElement | null;
    if (heading && /^H[2-6]$/.test(heading.tagName)) heading.toggleAttribute("data-no-match", empty);
  }
  const anchor = anchorIndex < 0 ? undefined : rows.slice(anchorIndex).find((row) => !row.hidden);
  if (scroller && anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
  // One match is the method the reader looked for: open it.
  const single = wanted && shown === 1 && only instanceof HTMLDetailsElement ? only : null;
  if (opened && opened !== single) opened.open = false;
  opened = null;
  if (single && !single.open) {
    single.open = true;
    opened = single;
  }
}
