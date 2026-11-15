import { cn } from "@/lib/utils";

interface KeycapProps {
  children: React.ReactNode;
  className?: string;
}

/** The small key of a hint row: the status bar and the search overlay's footer. */
export const SMALL_KEY = "rounded-md px-sm py-xs text-caption leading-none";

/** A physically-raised key. The one source of truth for a key in the landing page. */
export function Keycap({ children, className }: KeycapProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-ms py-sm text-label",
        "bg-linear-to-b from-elevated-top to-elevated-bottom border border-elevated-edge shadow-keycap",
        "text-foreground select-none",
        className,
      )}
    >
      {children}
    </span>
  );
}
