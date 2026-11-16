import { cn } from "@/lib/utils";

/**
 * The app's primary control: a raised, dark key.
 *
 * One definition, because it is the same button everywhere — the "Search" key
 * beside the landing field, and the "Continue" key of every onboarding step.
 * The caller states the width and the label; the surface is decided here.
 */
export function PrimaryButton({
  className,
  children,
  type = "button",
  ...rest
}: React.ComponentProps<"button">) {
  return (
    <button
      type={type}
      className={cn(
        "relative shrink-0 cursor-interactive select-none rounded-lg border border-neutral-800 dark:border-[oklch(1_0_0/18%)]",
        "bg-linear-to-b from-neutral-800 to-neutral-900 dark:from-neutral-900 dark:to-neutral-700",
        "px-md py-sm text-label text-sm font-semibold whitespace-nowrap text-neutral-50",
        // The sheen along the top edge is what makes the key read as raised.
        // The press drops it and sinks the key by the same 1px, so the two
        // states differ the way a real key does.
        "shadow-[0_1px_0.75px_0_oklch(0_0_0/28%),0_1px_2px_0_oklch(0_0_0/16%)]",
        "inset-shadow-[0_1px_0_0_oklch(1_0_0/12%)] dark:inset-shadow-[0_1px_0_0_oklch(0_0_0/10%)]",
        "transition duration-(--duration-fast) pointer-hover:brightness-115 active:translate-y-px active:brightness-100 active:inset-shadow-none",
        "disabled:cursor-wait motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
