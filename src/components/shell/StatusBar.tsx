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
import { Keycap } from "@/components/ui/Keycap";

const HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: [COMMAND_KEY, "K"], label: "Search" },
  { keys: [COMMAND_KEY, "C"], label: "Copy as Markdown" },
  { keys: [COMMAND_KEY, "D"], label: "Bookmark" },
];

export function StatusBar({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        // On the page's own axis (`px-page-x`), so the keys line up with the
        // text above them.
        "status-scrim flex h-statusbar shrink-0 items-center px-page-x select-none",
        className,
      )}
    >
      {/* Flat keys: the strip is furniture, and a row of raised caps under
          every page pulled the eye off the text. */}
      <div className="flex min-w-0 items-center gap-md overflow-hidden">
        {HINTS.map((hint) => (
          <span
            key={hint.label}
            className="flex shrink-0 items-center gap-[3px]"
          >
            {hint.keys.map((key) => (
              <Keycap key={key} flat>
                {key}
              </Keycap>
            ))}
            <span className="ml-[5px] text-[12px] text-neutral-400">{hint.label}</span>
          </span>
        ))}
      </div>
    </footer>
  );
}
