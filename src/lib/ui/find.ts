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

/** Mark the matches, and `current` apart from the rest. */
export function paint(ranges: Range[], current: number) {
  if (typeof Highlight === "undefined" || !CSS.highlights) return;
  CSS.highlights.set(ALL, new Highlight(...ranges));
  const one = ranges[current];
  if (one) CSS.highlights.set(CURRENT, new Highlight(one));
  else CSS.highlights.delete(CURRENT);
}

export function clearPaint() {
  CSS.highlights?.delete(ALL);
  CSS.highlights?.delete(CURRENT);
}

/** Scroll the box that holds the range until the range is in the middle of it,
    unless it is already in clear view. */
export function reveal(range: Range) {
  let box = range.startContainer.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return;
  const at = range.getBoundingClientRect();
  const view = box.getBoundingClientRect();
  // The sticky bar at the top and the key strip at the bottom cover a band.
  const margin = view.height * 0.2;
  if (at.top > view.top + margin && at.bottom < view.bottom - margin) return;
  box.scrollBy({ top: at.top - (view.top + view.height / 2) });
}
