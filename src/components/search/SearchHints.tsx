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
export function SearchHints({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-md border-t border-hairline text-meta text-neutral-500 select-none", className)}>
      {children}
      <div className="ml-auto flex items-center gap-md">
        {HINTS.map((hint) => (
          <span key={hint.label} className="flex items-center gap-xs">
            {hint.keys.map((key) => (
              <Keycap key={key} className={SMALL_KEY}>
                {key}
              </Keycap>
            ))}
            <span className="ml-2xs">{hint.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
