import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";
import { FADE_BOTH, FADE_OUT } from "@/lib/ui/overflow";

/**
 * A long list that only draws the rows on screen.
 *
 * A node context holds twelve hundred pages. Drawing them all costs a second
 * of layout on the click that opens the context, and every scroll after that
 * pays for the rows nobody is looking at. Only the visible slice is in the
 * DOM; the rest is one spacer of the right height, so the scrollbar still
 * says how long the list is.
 *
 * Every row must be exactly `rowHeight` tall. That is the price of not
 * measuring, and it is the same price the panel already pays for having one
 * row height.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  children,
  className,
  style,
  overscan = 8,
  reveal,
  revealBelow = 0,
  onTop,
}: {
  items: T[];
  rowHeight: number;
  children: (item: T, at: number) => React.ReactNode;
  className?: string;
  /** A caller that wants the list to be as tall as its content — and to
      shrink, not to stretch — states that height here. */
  style?: React.CSSProperties;
  overscan?: number;
  /** Told the scroll position on every frame it moves, so a caller can pin a
      header over the rows that have gone under it. */
  onTop?: (top: number) => void;
  /** A row the list must bring into view — the page the reader just opened
      from somewhere else. Only moves the list when the row is off screen, so
      a row already visible is not dragged under the pointer. */
  reveal?: number;
  /** How much of the list's top the caller draws over (pinned headers). A row
      under it is off screen too. */
  revealBelow?: number;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);
  // The most whole rows the parent leaves room for. The list ends on a row's
  // edge, so no sliver of a row shows through the fade at the bottom.
  const [whole, setWhole] = useState<number | undefined>(undefined);

  useEffect(() => {
    const element = node.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;
    const measure = () => {
      setHeight(element.clientHeight);
      setWhole(Math.max(1, Math.floor(parent.clientHeight / rowHeight)) * rowHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [rowHeight]);

  // The list is re-windowed on the frame, not on the event: a fast wheel
  // fires scroll far more often than the screen refreshes. And drawn in that
  // same frame: a state update from outside a React event waits for a later
  // task, and the frame between paints the new scroll over the old rows — a
  // strip of empty list.
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const at = node.current?.scrollTop ?? 0;
      flushSync(() => {
        setTop(at);
        onTop?.(at);
      });
    });
  }, []);

  // Before the paint, so the list is never seen at its old place with the
  // new rows, and re-windowed with it, so it is never seen at its new place
  // with the old ones.
  useLayoutEffect(() => {
    const element = node.current;
    if (!element || reveal === undefined || reveal < 0) return;
    const top = reveal * rowHeight;
    const box = element.clientHeight;
    if (top >= element.scrollTop + revealBelow && top + rowHeight <= element.scrollTop + box) return;
    // Centred, not flush against an edge: the rows around it are what say
    // where in the list the reader landed.
    element.scrollTop = Math.max(0, Math.round((top - box / 2) / rowHeight) * rowHeight);
    setTop(element.scrollTop);
    onTop?.(element.scrollTop);
  }, [reveal, revealBelow, rowHeight]);

  const total = items.length * rowHeight;
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const shown = Math.ceil(height / rowHeight) + overscan * 2;
  const slice = items.slice(first, first + shown);
  // The fade says there is more below. A list that fits must not wear one.
  const overflows = total > height + 1;

  return (
    <div
      ref={node}
      onScroll={onScroll}
      style={{ ...style, maxHeight: whole }}
      data-list=""
      className={cn(
        // The list comes to rest on a row's edge, so a header pinned over its
        // top (a whole number of rows) never stands over half a row.
        "thin-scroll min-h-0 snap-y snap-proximity overflow-y-auto",
        // The top edge only fades once something has gone under it.
        overflows && (top > 0 ? FADE_BOTH : FADE_OUT),
        className,
      )}
    >
      {/* The spacer holds the scroll length; the slice rides on top of it.
          The last row clears the fade, so nothing is ever read through it. */}
      <div style={{ height: total + (overflows ? 40 : 0) }} className="relative snap-end">
        <div style={{ transform: `translateY(${first * rowHeight}px)` }} className="[&>*]:snap-start">
          {slice.map((item, at) => children(item, first + at))}
        </div>
      </div>
    </div>
  );
}
