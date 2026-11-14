import { cn } from "@/lib/utils";

interface KeycapProps {
  children: React.ReactNode;
  /** A key named by the window's own furniture — the key strip, the panel —
      drawn as a quiet outline rather than a raised cap, so the chrome stays
      flat and the page keeps the eye. */
  flat?: boolean;
  className?: string;
}

/** The small key of a hint row: the status bar and the search overlay's footer. */
export const SMALL_KEY = "rounded-md px-sm py-xs text-caption leading-none";

/** The flat key's size: a 18px cap that sits in a line of 12px text. */
export const FLAT_KEY = "h-[18px] min-w-[18px] rounded-[5px] px-[5px] text-[10.5px] leading-none font-medium";

/** A physically-raised key. The one source of truth for a key in the landing page. */
export function Keycap({ children, flat = false, className }: KeycapProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-ms py-sm text-label select-none",
        flat
          ? cn("border border-hairline text-neutral-500", FLAT_KEY)
          : "bg-linear-to-b from-elevated-top to-elevated-bottom border border-elevated-edge shadow-keycap text-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
