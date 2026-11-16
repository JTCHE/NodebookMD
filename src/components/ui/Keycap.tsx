import { cn } from "@/lib/utils";

interface KeycapProps {
  children: React.ReactNode;
  className?: string;
}

/** The small key of a hint row, a menu row or a tooltip. Half the lift of a large key: in a menu row or a tooltip it sits beside text, not alone. */
export const SMALL_KEY = "rounded-md [corner-shape:squircle] px-sm py-xs text-caption leading-none shadow-[0_1px_0_0_var(--keycap-edge),0_1px_1px_0_oklch(0_0_0/8%)]";

/** A physically-raised key. The one source of truth for a key in the landing page. */
export function Keycap({ children, className }: KeycapProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-lg px-ms py-sm text-label",
        "bg-linear-to-b from-neutral-0 to-neutral-100 dark:from-neutral-200",
        "border border-(--keycap-edge) [--keycap-edge:var(--neutral-300)] dark:[--keycap-edge:var(--neutral-0)]",
        "shadow-[0_2px_0_0_var(--keycap-edge),0_1px_1.5px_0_oklch(0_0_0/10%)]",
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
