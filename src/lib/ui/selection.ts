/**
 * The text selection is drawn as a custom highlight, not as `::selection`.
 * Chromium fills a selection over the whole line box, so lines run together
 * into one block. A highlight covers only the glyphs, with a gap between
 * lines. Text fields keep `::selection`: a highlight cannot reach into them.
 */
export function startSelectionHighlight() {
  if (!("highlights" in CSS)) return;
  const highlight = new Highlight();
  CSS.highlights.set("selection", highlight);
  document.addEventListener("selectionchange", () => {
    highlight.clear();
    const selection = document.getSelection();
    if (!selection) return;
    for (let index = 0; index < selection.rangeCount; index++) highlight.add(selection.getRangeAt(index));
  });
}
