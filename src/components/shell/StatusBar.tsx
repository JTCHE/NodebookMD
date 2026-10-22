/**
 * The strip along the bottom: the three keys worth knowing.
 *
 * The keys are stated rather than discovered. A desktop reader who learns
 * ⌘K once never opens the search field with the pointer again, and the row
 * costs nothing — it is the space under the content, which is empty anyway.
 *
 * The index pass is not here. It shows on the build card, beside the counts
 * it changes, where the reader already looks.
 */
import { cn } from "@/lib/utils";
import { COMMAND_KEY } from "@/lib/hotkeys";
import { Keycap, SMALL_KEY } from "@/components/ui/Keycap";

const HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: [COMMAND_KEY, "K"], label: "Search" },
  { keys: [COMMAND_KEY, "C"], label: "Copy as Markdown" },
  { keys: [COMMAND_KEY, "D"], label: "Bookmark" },
];

export function StatusBar({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "status-scrim flex h-statusbar shrink-0 items-center gap-lg px-lg select-none",
        className,
      )}
    >
      {/* py-xs holds room for the keycap's own shadow (--elevation-keycap
          draws a hard edge below the cap). Without it, this row's box wraps
          the cap with no slack, and overflow-hidden — kept for narrow-window
          truncation — cuts the shadow off flush. The shadow's blur spreads
          sideways too, so px-2xs holds the same room on the left and right,
          and -mx-2xs gives it back: the first cap stays on the same axis. */}
      <div className="-mx-2xs flex min-w-0 items-center gap-md overflow-hidden px-2xs py-xs">
        {HINTS.map((hint) => (
          <span
            key={hint.label}
            className="flex shrink-0 items-center gap-xs"
          >
            {hint.keys.map((key) => (
              <Keycap
                key={key}
                className={SMALL_KEY}
              >
                {key}
              </Keycap>
            ))}
            <span className="ml-2xs text-meta text-neutral-500">{hint.label}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
