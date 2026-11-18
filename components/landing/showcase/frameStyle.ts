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
 * - On a phone (`data-phone`) the page time takes the middle of the title
 *   bar, where the build number would crowd it.
 * - No list of contents: inline on a narrow page, it would push the page's
 *   note into the fade; in the gutter of a wide one, it takes the room the
 *   page width slider needs to show.
 * - The driver's pointer sets no :hover, so its `data-hover` mark shows what a
 *   hover shows: a code block's copy button.
 */
const FRAME_STYLE = `
  .docs-shell { scrollbar-color: transparent transparent; mask-image: linear-gradient(#000 calc(100% - 110px), transparent calc(100% - 16px)); }
  html[data-pane] :is(header.h-titlebar, footer.status-scrim) { display: none; }
  html[data-phone] header.h-titlebar > span.text-caption { visibility: hidden; }
  nav[aria-label="On this page"] { display: none; }
  [class*="@min-toc:pr-"] { padding-right: 0 !important; }
  .group[data-hover] > .code-copy { opacity: 1; }
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
