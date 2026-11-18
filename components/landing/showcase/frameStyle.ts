"use client";

import { useEffect } from "react";

/**
 * What the frame changes in the app, as a style sheet in its document.
 *
 * - A page scrolls under the reader's wheel or finger, with no bar drawn, and
 *   fades out at its foot: the sample pages are short, and the fade stays at
 *   the foot, so the scroll stops on a page that fades rather than on a cut.
 * - In Houdini's pane (`data-pane`) the app has no window of its own, so no
 *   title bar and no hint row.
 * - On a phone (`data-phone`) the page time takes the gap in the title bar
 *   of the tab strip, where the build number would crowd it. The tour opens
 *   one tab, a phone has no window to minimize or maximize, and the logo says
 *   the name: those parts of the bar would leave the time no room. The Mac
 *   bar (an iPad, a narrow Mac window) has the least room of all.
 * - No list of contents: inline on a narrow page, it would push the page's
 *   note into the fade; in the gutter of a wide one, it takes the room the
 *   page width slider needs to show.
 * - The driver's pointer sets no :hover, so its `data-hover` mark shows what a
 *   hover shows: a code block's copy button.
 * - The app's sliders are drawn for its engines (WebView2, WebKit) only;
 *   Firefox gets the same track and knob (`.slider` in the app's globals.css).
 */
const FRAME_STYLE = `
  .docs-shell { scrollbar-color: transparent transparent; mask-image: linear-gradient(#000 calc(100% - 110px), transparent calc(100% - 16px)); }
  html[data-pane] :is(header.h-titlebar, footer.status-scrim) { display: none; }
  html[data-phone] header.h-titlebar > span.text-caption { visibility: hidden; }
  html[data-phone] header.h-titlebar :is([aria-label="Minimize"], [aria-label="Maximize"]) { display: none; }
  html[data-phone] header.h-titlebar [aria-label="Tabs"] > * { visibility: hidden; }
  html[data-phone] header.h-titlebar a[href="/"] > span { display: none; }
  nav[aria-label="On this page"] { display: none; }
  [class*="@min-toc:pr-"] { padding-right: 0 !important; }
  .group[data-hover] > .code-copy { opacity: 1; }
  .slider::-moz-range-track { height: 4px; border-radius: 999px; background: var(--neutral-300); }
  .slider::-moz-range-thumb { box-sizing: border-box; width: 16px; height: 16px; border: 0; border-radius: 999px; background: var(--raised); box-shadow: var(--elevation-chip), 0 0 0 1px var(--hairline); }
  [data-theme="dark"] .slider::-moz-range-thumb { background: oklch(0.92 0 0); }
  .slider-hue::-moz-range-track { background: var(--hue-wheel); }
  .slider-hue::-moz-range-thumb, [data-theme="dark"] .slider-hue::-moz-range-thumb { background: white; box-shadow: inset 0 0 0 4px var(--brand), 0 1px 2px oklch(0 0 0 / 30%); }
`;

/** Puts `FRAME_STYLE` in the app's document, and the flags it reads on its root. */
export function useFrameStyle(
  frame: React.RefObject<HTMLIFrameElement | null>,
  ready: boolean,
  { pane, phone }: { pane: boolean; phone: boolean },
) {
  useEffect(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!ready || !root) return;
    if (!root.querySelector("style[data-frame]")) {
      const style = root.ownerDocument.createElement("style");
      style.dataset.frame = "";
      style.textContent = FRAME_STYLE;
      root.ownerDocument.head.append(style);
    }
    root.toggleAttribute("data-pane", pane);
    root.toggleAttribute("data-phone", phone);
  }, [frame, ready, pane, phone]);
}
