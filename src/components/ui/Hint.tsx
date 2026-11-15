/**
 * The name of a button that shows only an icon, in the app's tooltip.
 *
 * A native `title` waits a second and draws the system's box, which reads as
 * another program. This one uses the box every link in the page uses, and
 * comes at once, as a link's does. The keys are drawn as keys.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TooltipBox } from "@/components/docs/Tooltip";
import { cn } from "@/lib/utils";
import { Keys } from "@/components/ui/Keycap";

/** Only long enough that a pointer moving across the bar does not light
    up every button it passes. */
const WAIT = 60;

/** `className` places the wrapper: a button that sits `absolute` gives its
    place to the wrapper, so the name is drawn at the button. */
export function Hint({ label, keys, side, className, children }: { label: string; keys?: string; side?: "above" | "below"; className?: string; children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number>(undefined);

  const hide = () => {
    window.clearTimeout(timer.current);
    setShown(false);
  };
  useEffect(() => hide, []);

  // With keycaps the box closes on them, so the right inset is the key inset; a label alone gets even sides.
  return (
    <span
      ref={anchor}
      className={cn("inline-flex shrink-0", className)}
      onPointerEnter={() => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setShown(true), WAIT);
      }}
      onPointerLeave={hide}
      // A press is the answer to the question the name was for.
      onPointerDown={hide}
    >
      {children}
      {shown && (
        <TooltipBox anchorRef={anchor} side={side} className={cn("z-[80] w-max max-w-[24rem] rounded-[11px] py-xs [corner-shape:squircle]", keys ? "pr-xs pl-sm" : "px-sm")}>
          <span className="flex items-center gap-2 font-medium text-foreground">
            {label}
            {keys && (
              <Keys keys={keys} />
            )}
          </span>
        </TooltipBox>
      )}
    </span>
  );
}
