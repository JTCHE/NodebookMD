import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { FADE_IN, FADE_OUT, useOverflow } from "@/lib/ui/overflow";

/**
 * A list that scrolls inside its own box and falls off at one edge.
 *
 * Every long list in the window is this: the tree, the recents, the library
 * panel. A list is never cut across a row — it fades, which says there is more
 * beyond it — and it never fades when the last row is already on screen, which
 * would say the same thing and be a lie.
 */
export function FadeList({
  children,
  className,
  deps = [],
  reverse = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** What changes the length of the list, so the fade is measured again. */
  deps?: unknown[];
  /** For a list that reads oldest-to-newest top-to-bottom, newest at the
      bottom (the Recents trail): the fade moves to the top, and the box opens
      already scrolled down to the newest row rather than up to the oldest. */
  reverse?: boolean;
}) {
  const node = useRef<HTMLDivElement>(null);
  const overflows = useOverflow(node, [children, ...deps], reverse);

  useEffect(() => {
    if (reverse) node.current?.scrollTo({ top: node.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return (
    <div
      ref={node}
      // The mark says "this scroller is a list". A page of prose scrolls too,
      // and must NOT fade; the design harness reads this to tell them apart.
      data-list=""
      className={cn(
        "thin-scroll flex min-h-0 flex-col overflow-y-auto",
        // The last row on screen sits in the fade, so the list reads as
        // going on; a scroll brings it out.
        overflows && (reverse ? FADE_IN : FADE_OUT),
        className,
      )}
    >
      {children}
    </div>
  );
}
