import { cn } from "@/lib/utils";

/**
 * An on/off switch. One track, one knob, and the two states a reader can see
 * from across the room: on is a track in ink, off is a pale one. The brand is
 * kept for the one thing in a view that matters, not for every switch.
 *
 * The knob moves on `transform` alone, so the compositor draws the change and
 * the main thread does nothing. See AGENTS.md, "Animation and compositing".
 */
export function Toggle({
  checked,
  disabled,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  /** Greyed and inert, for a setting that cannot change yet. */
  disabled?: boolean;
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
      disabled={disabled}
      aria-label={label}
      onClick={() => onChange(!checked)}
      // A click flips the switch and leaves the focus where it was, so the
      // key that ends the screen keeps answering Enter.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "relative h-[20px] w-[34px] shrink-0 cursor-interactive rounded-full",
        "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        // Off is a mid grey, dark enough to read as a live control; disabled
        // fades the whole switch, so the two never look alike.
        checked ? "bg-neutral-950" : "bg-neutral-400",
        "disabled:cursor-not-allowed disabled:opacity-35",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // The knob is the ground's own colour on an ink track, and white on
          // the pale one, so it stands out of the track in both themes.
          "absolute top-[2px] left-[2px] size-[16px] rounded-full shadow-chip",
          "transition-transform duration-(--duration-base) motion-reduce:transition-none",
          checked ? "translate-x-[14px] bg-neutral-0" : "bg-white",
        )}
      />
    </button>
  );
}
