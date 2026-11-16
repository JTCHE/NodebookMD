import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/Hint";

/** A sunken track: the look of every control that holds a choice, so a picker
    and a select read as one kind of thing, apart from the raised buttons that
    act. A pale fill and no line, so the chosen chip carries the weight. */
export const TRACK = "h-row rounded-lg bg-neutral-100";

/**
 * One choice out of a few short ones, side by side in one track: a theme, a
 * link form. The chosen one is a chip lifted off the track, and the chip
 * slides to the next choice instead of jumping. The arrow keys move the
 * choice, as in a radio group.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  /** Null while the setting is read: the track draws, no chip is lifted. */
  value: T | null;
  /** `hint` shows under the pointer, for a choice whose label needs an example. */
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const chosenIndex = options.findIndex((one) => one.value === value);
  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (Math.max(0, chosenIndex) + step + options.length) % options.length;
    onChange(options[next].value);
    track.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  }
  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      // As wide as its content, cut into equal segments of the longest
      // label, so the chip keeps its size as it slides. The chip's radius is the track's
      // radius less the 2px inset, so the two nest.
      className={cn(TRACK, "relative inline-grid shrink-0 auto-cols-fr grid-flow-col gap-2xs p-2xs")}
    >
      {chosenIndex >= 0 && (
        <span
          aria-hidden="true"
          className="absolute inset-y-2xs left-2xs rounded-md bg-raised shadow-chip transition-transform duration-(--duration-base) motion-reduce:transition-none"
          style={{
            width: `calc((100% - ${options.length + 1} * var(--spacing-2xs)) / ${options.length})`,
            transform: `translateX(calc(${chosenIndex} * (100% + var(--spacing-2xs))))`,
          }}
        />
      )}
      {options.map((one, index) => {
        const chosen = index === chosenIndex;
        const button = (
          <button
            key={one.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            // Only the chosen one is a tab stop; the arrows reach the rest.
            tabIndex={chosen || (chosenIndex < 0 && index === 0) ? 0 : -1}
            onClick={() => onChange(one.value)}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              // Geist sits high in its line: 1px at the top centres its capitals.
              "relative h-full w-full min-w-0 cursor-interactive rounded-md px-sm pt-px text-center text-label font-medium dark:font-normal whitespace-nowrap",
              "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              chosen ? "text-neutral-950" : "text-neutral-500 dark:text-neutral-600 pointer-hover:bg-foreground/[0.05] pointer-hover:text-neutral-900 active:bg-foreground/[0.08]",
            )}
          >
            {one.label}
          </button>
        );
        return one.hint ? (
          <Hint key={one.value} label={one.hint}>
            {button}
          </Hint>
        ) : (
          button
        );
      })}
    </div>
  );
}
