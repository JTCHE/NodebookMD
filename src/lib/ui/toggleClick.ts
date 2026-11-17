/**
 * A click on a collapsible title toggles it only when the reader meant a
 * click: a drag that selects text, or a double or triple click that selects
 * a word or a line, leaves it as it is. The toggle waits for the double-click
 * window, so the second click can cancel it.
 */
const DOUBLE_CLICK_WINDOW = 220;
/** A press that travels further than this is a drag. */
const DRAG_DISTANCE = 4;

let pending = 0;
let pressX = 0;
let pressY = 0;

document.addEventListener("pointerdown", (event) => {
  pressX = event.clientX;
  pressY = event.clientY;
}, true);

export function toggleOnClick(event: MouseEvent, toggle: () => void) {
  window.clearTimeout(pending);
  // A key press is never a selection.
  if (event.detail === 0) return toggle();
  if (event.detail > 1 || event.shiftKey) return;
  if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_DISTANCE) return;
  pending = window.setTimeout(toggle, DOUBLE_CLICK_WINDOW);
}

/** Method rows are native `details`: take their summary clicks over. */
export function startSummaryClicks() {
  document.addEventListener("click", (event) => {
    const target = event.target as Element | null;
    const summary = target?.closest?.("details.hom-method > summary");
    if (!summary || target?.closest("a, button")) return;
    event.preventDefault();
    const row = summary.parentElement as HTMLDetailsElement;
    toggleOnClick(event, () => {
      row.open = !row.open;
    });
  });
}
