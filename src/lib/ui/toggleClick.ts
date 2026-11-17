/**
 * A click on a collapsible title toggles it at once. A drag, or a press
 * held long, starts a selection and does not toggle it. The second click
 * of a double click undoes the first, so a double click selects a word and leaves the row as it was: the
 * motion reverses mid-way instead of the click waiting.
 */
/** A press that travels further than this is a drag. */
const DRAG_DISTANCE = 4;
/** A press held longer than this is the start of a selection, not a click. */
const HOLD = 350;

let pressX = 0;
let pressY = 0;
let pressTime = 0;
let lastToggle: (() => void) | null = null;

document.addEventListener("pointerdown", (event) => {
  pressX = event.clientX;
  pressY = event.clientY;
  pressTime = event.timeStamp;
}, true);

export function toggleOnClick(event: MouseEvent, toggle: () => void) {
  if (event.detail === 2 && lastToggle) {
    lastToggle();
    lastToggle = null;
    return;
  }
  lastToggle = null;
  // A key press is never a selection.
  if (event.detail === 0) return toggle();
  if (event.detail > 1 || event.shiftKey) return;
  if (event.detail === 1 && event.timeStamp - pressTime > HOLD) return;
  if (Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_DISTANCE) return;
  toggle();
  lastToggle = toggle;
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
