import type { ReactNode } from "react";
import { Keycap, SMALL_KEY } from "@/components/ui/Keycap";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, CornerDownLeft } from "lucide-react";

// Drawn keys, not font arrows: the font gives each arrow its own size and weight.
const GLYPH = "size-[1em] stroke-[2.25]";
const DRAWN: Record<string, ReactNode> = {
  "↑": <ArrowUp className={GLYPH} aria-label="Up" />,
  "↓": <ArrowDown className={GLYPH} aria-label="Down" />,
  "↵": <CornerDownLeft className={GLYPH} aria-label="Enter" />,
};

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
                {DRAWN[key] ?? key}
              </Keycap>
            ))}
            <span className="ml-2xs">{hint.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
