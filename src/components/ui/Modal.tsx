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

export const MODAL_TOP = "pt-[20px]";
export const MODAL_LINE = "flex h-7 shrink-0 items-center";

export function Modal({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose: () => void;
  className?: string;
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
      <div className={SCRIM} />
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
        <Hint label="Close" keys="Esc" className="absolute top-[20px] right-[20px] z-10">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cn(
            "grid size-7 cursor-interactive place-items-center rounded-md text-neutral-500",
            "pointer-hover:bg-neutral-100 pointer-hover:text-neutral-800",
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
