import type { ReactNode } from "react";
import { Keycap, SMALL_KEY } from "@/components/ui/Keycap";
import { cn } from "@/lib/utils";

const HINTS: Array<{ keys: string[]; label: string }> = [
  { keys: ["↑", "↓"], label: "navigate" },
  { keys: ["↵"], label: "open" },
  { keys: ["esc"], label: "close" },
];

/** The foot of every result list: what the caller puts on the left, and the
    keys that drive the list on the right. */
/** `single`: one row, so there is nothing to walk with the arrows. */
export function SearchHints({ children, className, single = false }: { children?: ReactNode; className?: string; single?: boolean }) {
  return (
    <div className={cn("flex items-center gap-md border-t border-hairline text-meta text-neutral-500 select-none", className)}>
      {children}
      <div className="ml-auto flex items-center gap-md">
        {HINTS.filter((hint) => !(single && hint.label === "navigate")).map((hint) => (
          <span key={hint.label} className="flex items-center gap-xs">
            {hint.keys.map((key) => (
              <Keycap key={key} className={SMALL_KEY}>
                {/* The font draws ↵ at half the height of the arrows; a scale
                    grows the glyph and not the key. */}
                {key === "↵" ? <span className="inline-block scale-150">{key}</span> : key}
              </Keycap>
            ))}
            <span className="ml-2xs">{hint.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
