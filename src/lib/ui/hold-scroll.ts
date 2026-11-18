/**
 * Keeps the reader's line in place while the page column changes width, as
 * when the sidebar opens or closes. The text reflows, so the same scrollTop
 * shows another line. The first block that starts in the view is the anchor:
 * after each resize of the scroller, the scroll moves so the anchor is back
 * where it was.
 */

/** How long to follow resizes, longer than the sidebar's own motion. */
const HOLD_TIME = 600;
/** The sticky page bar covers the top of the view; a line under it is not read. */
const PAGE_BAR_ROOM = 48;

export function holdScrollPosition() {
  const scroller = document.querySelector<HTMLElement>(".docs-shell");
  if (!scroller) return;
  const viewTop = scroller.getBoundingClientRect().top;
  const anchor = [...scroller.querySelectorAll<HTMLElement>("main :is(h1,h2,h3,h4,p,li,tr,pre)")].find(
    (element) => element.getBoundingClientRect().top >= viewTop + PAGE_BAR_ROOM,
  );
  if (!anchor) return;
  const offset = anchor.getBoundingClientRect().top - viewTop;
  const restore = () => {
    const drift = anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
    if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
  };
  const observer = new ResizeObserver(restore);
  observer.observe(scroller);
  observer.observe(anchor);
  setTimeout(() => observer.disconnect(), HOLD_TIME);
}
