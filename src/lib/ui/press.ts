/**
 * EVERY CONTROL IN THE WINDOW ACTS ON THE PRESS, NOT ON THE RELEASE.
 *
 * A browser raises `click` only after the button comes back up, so a control
 * wired to `onClick` waits out the whole time a finger rests on it — about a
 * tenth of a second, every time. That wait is the difference between a panel
 * that answers and a panel that lags, and it is the only thing separating this
 * app from the website it replaces.
 *
 * The rule is ONE listener on the document, not a prop each control has to
 * remember. A control opts in by being a control: a link, a button, or
 * anything wearing `role="button"`. Nothing has to be wired up, and a control
 * written next year is fast the day it is written.
 *
 * How it works: the press finds the control under the pointer and clicks it
 * there and then. The browser still raises its own click when the button comes
 * back up, and that one is swallowed — so every handler runs exactly once, and
 * every handler is still a plain `onClick`.
 */
import { isTyping } from "@/lib/hotkeys";

/** A press the app owns: main button, no modifier. A modified press is the
    reader asking the browser for something else — a new tab, a context menu —
    and must reach the control untouched. */
export function isPlainPress(event: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}) {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/** What a press acts on. `data-press="off"` takes a control out of the rule,
    for the rare control whose whole point is the release. */
const CONTROLS = 'a[href], button, [role="button"]';

/** The control this press has already clicked, waiting for the browser's own
    click so it can be swallowed. */
let pressed: Element | null = null;

/** Makes every control in the window act on the press. Called once, from
    `main.tsx`. */
export function startPress() {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!isPlainPress(event)) return;
      const target = event.target as Element | null;
      const control = target?.closest?.(CONTROLS) as HTMLElement | null;
      if (!control || control.closest('[data-press="off"]')) return;
      if (control.matches(":disabled") || control.getAttribute("aria-disabled") === "true") return;

      // The press itself is NOT cancelled: cancelling it takes away the focus
      // move, the text selection and the drag the browser would have done, and
      // none of those is this rule's business. Only the field the reader was
      // typing in has to let go, or every shortcut that stands down while they
      // type stays down after they press a button.
      const typing = document.activeElement;
      if (typing !== control && isTyping(typing)) (typing as HTMLElement).blur();

      pressed = control;
      // A click raised inside the press takes `:active` away from the control
      // in Chromium, so the pressed look would never draw. The mark stands in
      // for it until the button comes up; `active:` reads both (globals.css).
      control.setAttribute("data-pressed", "");
      control.click();
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      // `detail` is 0 for a click nobody pointed at — the keyboard's, and the
      // one raised just above. Only a real pointer's click is the leftover.
      if (!pressed || event.detail === 0) return;
      const control = (event.target as Element | null)?.closest?.(CONTROLS);
      if (control !== pressed) return;
      pressed = null;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );

  // A press that never reaches its click — the pointer left the control, or
  // the control went away with the click it fired — must not leave the next
  // click on that control swallowed.
  document.addEventListener("pointerup", () => setTimeout(() => (pressed = null), 0), true);
  const release = () => {
    for (const control of document.querySelectorAll("[data-pressed]")) control.removeAttribute("data-pressed");
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
}
