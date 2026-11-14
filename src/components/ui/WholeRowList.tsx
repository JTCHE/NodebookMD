import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A list in a box the page sizes, that shows whole rows only.
 *
 * The box is cut down to a whole number of rows, and scrolling comes to rest
 * on a row's edge. The list ends on a row, never on half of one and never in
 * a fade: where it ends is an accident of the window's height, and a fade
 * there only hides the accident behind a ghost of a row.
 *
 * The parent gives the height; this takes the most whole rows of it.
 */
export function WholeRowList({
  children,
  rowHeight,
  className,
}: {
  children: React.ReactNode;
  rowHeight: number;
  className?: string;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const element = slot.current;
    if (!element) return;
    const measure = () => setHeight(Math.max(1, Math.floor(element.clientHeight / rowHeight)) * rowHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rowHeight]);

  return (
    <div ref={slot} className="h-full min-h-0">
      <div
        data-list=""
        style={{ height }}
        className={cn("thin-scroll snap-y snap-mandatory overflow-y-auto [&>*]:snap-start", className)}
      >
        {children}
      </div>
    </div>
  );
}
