import { cn } from "@/lib/utils";

interface KeycapProps {
  children: React.ReactNode;
  className?: string;
}

/** The small key of a hint row: the status bar and the search overlay's footer. */
export const SMALL_KEY = "rounded-md [corner-shape:squircle] px-sm py-xs text-caption leading-none";

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

/** A shortcut such as "Ctrl+C", one small key per part: tooltips and menu rows draw it the same way. */
export function Keys({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2xs font-normal", className)}>
      {keys.split("+").map((key) => (
        <Keycap key={key} className={SMALL_KEY}>
          {key}
        </Keycap>
      ))}
    </span>
  );
}
