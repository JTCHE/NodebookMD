/**
 * Find in page, for ⌘F and Ctrl F.
 *
 * The webviews have no find bar of their own on macOS and Linux, and the one
 * WebView2 draws on Windows does not look like this app. So the app draws it
 * (components/shell/FindBar) and marks the matches with the CSS Custom
 * Highlight API: no element goes into the page, so React's tree is not touched.
 */

const ALL = "find";
const CURRENT = "find-current";

/** Each match in `root`, in reading order. Case does not count. A match can
    run across elements, as "box SOP" does when SOP is in a code span. */
export function findRanges(root: HTMLElement, query: string): Range[] {
  const want = query.toLowerCase();
  if (!want) return [];
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement;
    // Text the reader cannot see: a closed section, a hidden copy for the
    // screen reader. `checkVisibility` is missing on older webviews.
    if (!owner || owner.checkVisibility?.() === false) continue;
    nodes.push(node as Text);
    starts.push(text.length);
    text += node.nodeValue ?? "";
  }
  const lower = text.toLowerCase();
  const at = (offset: number, end: boolean) => {
    // The last node that starts at or before the offset. An end that lands on
    // a node's start belongs to the node before it.
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (starts[mid] < offset || (!end && starts[mid] === offset)) low = mid;
      else high = mid - 1;
    }
    return { node: nodes[low], offset: offset - starts[low] };
  };
  const ranges: Range[] = [];
  for (let from = lower.indexOf(want); from >= 0; from = lower.indexOf(want, from + want.length)) {
    const start = at(from, false);
    const end = at(from + want.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    ranges.push(range);
  }
  return ranges;
}

/* One highlight per name, made once and changed in place. WebKit repaints a
   range that leaves a highlight, but not the ranges of a highlight that is
   replaced or removed: on macOS the marks of every earlier word stayed. */
let marks: { all: Highlight; one: Highlight } | null = null;
function highlights() {
  if (marks || typeof Highlight === "undefined" || !CSS.highlights) return marks;
  marks = { all: new Highlight(), one: new Highlight() };
  CSS.highlights.set(ALL, marks.all);
  CSS.highlights.set(CURRENT, marks.one);
  return marks;
}

/** Mark the matches, and `current` apart from the rest. */
export function paint(ranges: Range[], current: number) {
  const set = highlights();
  if (!set) return;
  set.all.clear();
  set.one.clear();
  for (const range of ranges) set.all.add(range);
  if (ranges[current]) set.one.add(ranges[current]);
}

export function clearPaint() {
  marks?.all.clear();
  marks?.one.clear();
}

/** The box that scrolls the range, or null. */
function scroller(range: Range): HTMLElement | null {
  let box = range.startContainer.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  return box;
}

/** True for a range in a box that does not scroll with the page: the list of
    contents and the page bar. Such a match is always on screen. */
function pinned(range: Range): boolean {
  for (let el = range.startContainer.parentElement; el && el.tagName !== "MAIN"; el = el.parentElement) {
    if (/sticky|fixed/.test(getComputedStyle(el).position)) return true;
  }
  return false;
}

/** The match nearest the view: the first in view or under it going down (1),
    the last in view or over it going up (-1). A pinned match counts only when
    the page has no other. */
export function nearest(ranges: Range[], direction: 1 | -1): number {
  const free = ranges.map((range, i) => ({ range, i })).filter(({ range }) => !pinned(range));
  const list = free.length ? free : ranges.map((range, i) => ({ range, i }));
  if (list.length === 0) return -1;
  const box = scroller(list[0].range);
  const view = box?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
  if (direction === 1) return (list.find(({ range }) => range.getBoundingClientRect().bottom > view.top) ?? list[0]).i;
  return (list.findLast(({ range }) => range.getBoundingClientRect().top < view.bottom) ?? list[list.length - 1]).i;
}

/** Scroll the box that holds the range until the range is in the middle of it,
    unless it is already in clear view. */
export function reveal(range: Range) {
  const box = scroller(range);
  if (!box) return;
  const at = range.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  // The sticky bar at the top and the key strip at the bottom cover a band.
  const margin = view.height * 0.2;
  if (at.top > view.top + margin && at.bottom < view.bottom - margin) return;
  box.scrollBy({ top: at.top - (view.top + view.height / 2) });
}
