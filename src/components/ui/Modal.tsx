/**
 * A panel over the window, with the page dimmed behind it: Settings, and the
 * questions an action has to ask first. Escape or a press on the dim closes it.
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { Hint } from "@/components/ui/Hint";

/** The first line of a modal: its title and the close button stand on it.
    A column that starts a modal starts with `MODAL_TOP` and puts its title in
    a `MODAL_LINE`, so every title and the close button share one axis. */
/** The ground behind every modal: the page dimmed and blurred, the same in
    Settings, a question and the search overlay. The blur is dropped where the
    window draws in software: see lib/ui/blur. What sits on top keeps a layer
    of its own (`transform-gpu`). It fades in with the panel: a dim that comes
    at once, before the panel, reads as a black flash. */
export const SCRIM =
  "absolute inset-0 bg-black/50 scrim-blur transition-opacity duration-(--duration-fast) starting:opacity-0 motion-reduce:transition-none";

/** The modal's inset. Content padded by it ends where the close button's
    cross ends: the button hangs its own padding past that line (`CLOSE`). */
export const MODAL_TOP = "pt-lg";
export const MODAL_LINE = "flex h-7 shrink-0 items-center";

/** The close button is 28px and its cross is 8px, so the cross stands 10px
    inside the button. The button gives those 10px back, as every ghost
    button gives back its padding. A title's capitals sit 1px above the
    middle of its line, so the cross moves up by as much to meet them. */
const CLOSE = "top-[calc(var(--spacing-lg)-1px)] right-[calc(var(--spacing-lg)-10px)]";

export function Modal({
  label,
  onClose,
  className,
  closeAt = CLOSE,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
  /** Where the close button stands, for a modal whose title line holds
      controls of its own. */
  closeAt?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-md" onMouseDown={onClose}>
      <div data-scrim className={SCRIM} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          "pop-in relative flex max-h-full transform-gpu flex-col overflow-hidden rounded-xl border border-hairline bg-background shadow-2xl",
          className,
        )}
      >
        <Hint label="Close" keys="Esc" className={cn("absolute z-10", closeAt)}>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cn(
              "grid size-7 cursor-interactive place-items-center rounded-md text-neutral-500",
              "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
              "pointer-hover:bg-neutral-100 pointer-hover:text-neutral-800 active:bg-neutral-200",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            )}
          >
            <Icons.dismiss className="size-4" />
          </button>
        </Hint>
        {children}
      </div>
    </div>,
    document.body,
  );
}
