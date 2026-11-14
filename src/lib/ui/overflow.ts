import { useEffect, useState, type RefObject } from "react";

/**
 * Whether a scroller holds more than it can show.
 *
 * The fade at the bottom of a list is a promise that there is more below it.
 * A list that fits must not wear one — on two rows the gradient reaches the
 * second row and reads as a rendering fault — so every list that fades asks
 * this first.
 */
export function useOverflow(node: RefObject<HTMLElement | null>, deps: unknown[] = []): boolean {
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = node.current;
    if (!element) return;
    // A row's hit-area padding and its cancelling negative margin round to
    // the pixel independently, which can leave a list a couple of px taller
    // than its box with no extra row behind it. 4px clears that without
    // hiding a real one, which is always at least one row's worth more.
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return overflows;
}

/** The fade itself, so every list in the app falls off the same way. The
    ramps live in globals.css (`.fade-*`), eased so no row ends on a hard line.

    The top edge fades too, but shorter: the bottom fade is a promise of more
    to come, while the top only says that a row passes under the header above
    it. A list with headers pinned over its top sets `--fade-top` to their
    height, so the rows are gone under the headers and fade in below them. */
export const FADE_OUT = "fade-out";

/** Both edges: a short fade in at the top, the full fade out at the bottom. */
export const FADE_BOTH = "fade-both";

/** The mirror of `FADE_OUT`, for a list that reads newest-at-the-bottom (the
    Recents trail): the full fade sits at the TOP and the bottom gets none. */
export const FADE_IN = "fade-in";
