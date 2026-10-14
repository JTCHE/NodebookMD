/**
 * Scroll to a run of words on the page and mark it for a moment.
 *
 * A search excerpt is the index's snippet of one section: words from the page,
 * with `…` where the snippet was cut. The longest piece between the cuts is
 * found by its words, not its characters, because the index keeps no markup
 * and no punctuation of links. A match at or after `from`, the section the hit
 * named, wins over an earlier one.
 */
import { excerptText } from "@/lib/search";

// No `_`: the excerpt keeps Markdown's `_emphasis_`, and the page does not.
const WORD = /[\p{L}\p{N}]+/gu;
const HOLD_MS = 1600;
const BLOCK = "p, li, td, th, dt, dd, h1, h2, h3, h4, h5, h6, pre, blockquote, figcaption, div";

/** The words of a text, lower case, where each starts. A bare number is
    left out: the page draws a list's numbers, and the index writes them. */
function words(text: string) {
  return [...text.toLowerCase().matchAll(WORD)]
    .filter((m) => !/^\d+$/.test(m[0]))
    .map((m) => ({ word: m[0], at: m.index! }));
}

export function flashText(
  article: HTMLElement,
  layer: HTMLElement,
  scroller: HTMLElement,
  excerpt: string,
  from: Element | null,
): boolean {
  const piece = excerptText(excerpt)
    .split("…")
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length)[0];
  const all = words(piece ?? "").map((w) => w.word);
  if (all.length === 0) return false;

  // The article's text as one string, and where each text node starts in it.
  // A new block starts with a space: two table cells are two words, not one.
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = "";
  let block: Element | null = null;
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement?.closest(BLOCK) ?? null;
    if (owner !== block) text += " ";
    block = owner;
    nodes.push(node as Text);
    starts.push(text.length);
    text += node.nodeValue ?? "";
  }
  const page = words(text);

  let after = 0;
  if (from && article.contains(from)) {
    const before = document.createRange();
    before.setStart(article, 0);
    before.setEndBefore(from);
    after = before.toString().length;
  }

  const find = (want: string[]) => {
    let first = -1;
    for (let i = 0; i + want.length <= page.length; i += 1) {
      if (!want.every((word, j) => page[i + j].word === word)) continue;
      if (first < 0) first = i;
      if (page[i].at >= after) return i;
    }
    return first;
  };
  // The whole piece, then each half of it: a snippet can run across a list
  // or a table, where the page draws text the index does not have.
  const half = Math.ceil(all.length / 2);
  const tries = [
    { at: 0, count: all.length },
    { at: 0, count: half },
    { at: half, count: all.length - half },
  ].filter((one, i) => i === 0 || one.count >= 3);
  let at = 0;
  let count = 0;
  let first = -1;
  for ({ at, count } of tries) {
    first = find(all.slice(at, at + count));
    if (first >= 0) break;
  }
  if (first < 0) return false;
  // A half that matched takes in each word next to it that the page has too.
  while (at > 0 && first > 0 && page[first - 1].word === all[at - 1]) {
    at -= 1;
    first -= 1;
    count += 1;
  }
  while (at + count < all.length && first + count < page.length && page[first + count].word === all[at + count]) {
    count += 1;
  }

  const locate = (offset: number) => {
    let at = 0;
    while (at + 1 < starts.length && starts[at + 1] <= offset) at += 1;
    return { node: nodes[at], offset: offset - starts[at] };
  };
  const last = page[first + count - 1];
  const start = locate(page[first].at);
  const end = locate(last.at + last.word.length);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  // The page keeps growing after it opens: pictures load, tables settle. The
  // words move with it, so the marks are placed again on each change, and the
  // scroll keeps the words a third of the way down — where the eye lands on a
  // page that just opened — until the reader scrolls for themselves.
  let aiming = true;
  let marks: HTMLDivElement[] = [];
  const place = () => {
    if (aiming) {
      const box = range.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      scroller.scrollBy({ top: box.top - view.top - scroller.clientHeight / 3, behavior: "instant" });
    }
    // One mark per run of words on a line. A range gives a box per inline
    // element, so a link and the text in it would each draw, and two tints
    // read darker than one. Two table cells on one row stay two marks.
    const lines: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      const line = lines.find(
        (l) => rect.top < l.bottom - 2 && rect.bottom > l.top + 2 && rect.left < l.right + 8 && rect.right > l.left - 8,
      );
      if (!line) lines.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
      else {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        line.top = Math.min(line.top, rect.top);
        line.bottom = Math.max(line.bottom, rect.bottom);
      }
    }
    while (marks.length > lines.length) marks.pop()!.remove();
    while (marks.length < lines.length) {
      const mark = document.createElement("div");
      mark.className = "flash-mark";
      layer.append(mark);
      marks.push(mark);
    }
    // The box a mark is placed against: the layer's nearest positioned
    // ancestor, which need not be the layer itself.
    const origin = (marks[0]?.offsetParent ?? layer).getBoundingClientRect();
    lines.forEach((line, i) =>
      Object.assign(marks[i].style, {
        left: `${line.left - origin.left - 2}px`,
        top: `${line.top - origin.top}px`,
        width: `${line.right - line.left + 4}px`,
        height: `${line.bottom - line.top}px`,
      }),
    );
  };
  const watch = new ResizeObserver(place);
  watch.observe(article);
  const yield_ = () => (aiming = false);
  scroller.addEventListener("wheel", yield_, { passive: true, once: true });
  scroller.addEventListener("touchstart", yield_, { passive: true, once: true });
  place();

  setTimeout(() => {
    watch.disconnect();
    scroller.removeEventListener("wheel", yield_);
    scroller.removeEventListener("touchstart", yield_);
    for (const mark of marks) {
      mark.dataset.fading = "";
      // With reduced motion there is no transition, so no transitionend.
      setTimeout(() => mark.remove(), 1000);
    }
    marks = [];
  }, HOLD_MS);
  return true;
}
