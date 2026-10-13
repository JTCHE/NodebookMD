import { cn } from "@/lib/utils";

/**
 * An on/off switch. One track, one knob, and the two states a reader can see
 * from across the room: the track carries the brand when it is on.
 *
 * The knob moves on `transform` alone, so the compositor draws the change and
 * the main thread does nothing. See AGENTS.md, "Animation and compositing".
 */
export function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What the switch turns on, for a reader who cannot see the row beside it. */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      // A click flips the switch and leaves the focus where it was, so the
      // key that ends the screen keeps answering Enter.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "relative h-[24px] w-[48px] shrink-0 cursor-interactive rounded-full",
        "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        checked ? "bg-brand" : "bg-neutral-300",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // The knob is near-white in both themes, the way the ink on a brand
          // plate is, so it never sinks into a dark track.
          "absolute top-[3px] left-[3px] size-[18px] rounded-full bg-brand-foreground shadow-chip",
          "transition-transform duration-(--duration-fast) motion-reduce:transition-none",
          checked && "translate-x-[24px]",
        )}
      />
    </button>
  );
}
