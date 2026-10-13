import { useRef, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/**
 * One choice out of a few short ones, side by side in one track: a theme, a
 * link form. The chosen one is a chip lifted off the track, as the sidebar's
 * row you are on is. The arrow keys move the choice, as in a radio group.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  /** Null while the setting is read: the track draws, no chip is lifted. */
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  function onKeyDown(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = Math.max(0, options.findIndex((one) => one.value === value));
    const next = (at + step + options.length) % options.length;
    onChange(options[next].value);
    track.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  }
  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex shrink-0 gap-[2px] rounded-lg border border-hairline bg-neutral-100 p-[2px]"
    >
      {options.map((one) => {
        const chosen = one.value === value;
        return (
          <button
            key={one.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            // Only the chosen one is a tab stop; the arrows reach the rest.
            tabIndex={chosen || (value === null && one === options[0]) ? 0 : -1}
            onClick={() => onChange(one.value)}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "h-[26px] cursor-interactive rounded-md px-sm text-[13px] font-medium whitespace-nowrap",
              "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              chosen ? "bg-raised text-neutral-950 shadow-chip" : "text-neutral-500 pointer-hover:text-neutral-900",
            )}
          >
            {one.label}
          </button>
        );
      })}
    </div>
  );
}
