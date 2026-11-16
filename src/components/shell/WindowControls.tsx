/**
 * Minimize, maximize and close, drawn by the app.
 *
 * The window has no system frame (`decorations: false` in `tauri.conf.json`),
 * which is what puts the title bar and these buttons on one row instead of two.
 * macOS keeps its frame, and its traffic lights take the place of these
 * (`window` in `lib.rs`).
 * The price is that the OS no longer draws them, so the shapes, the hit
 * targets and the close button's red hover are stated here — at the sizes
 * Windows uses, so they read as the window's own buttons and not as three more
 * controls inside the page.
 */
import { useEffect, useRef, useState } from "react";
import type { Window } from "@tauri-apps/api/window";
import { appWindow } from "@/lib/backend";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { IS_MAC } from "@/lib/hotkeys";

/* Windows' own caption button: a wide, short target with no radius, reaching
   the full height of the bar so the pointer catches it at the screen corner. */
export const CAPTION_BUTTON =
  "grid h-full w-[46px] shrink-0 cursor-interactive place-items-center text-neutral-700 " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:bg-neutral-200 active:bg-neutral-300 " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:-ring-offset-2";

/** A yes-or-no state of the window that the system can change without the
    app: maximized, full screen. Read again on every resize. `false` outside a
    Tauri window, where there is no window to ask. */
export function useWindowFlag(ask: (shell: Window) => Promise<boolean>): boolean {
  const [flag, setFlag] = useState(false);
  const latest = useRef(ask);
  latest.current = ask;
  useEffect(() => {
    const shell = appWindow();
    if (!shell) return;
    let live = true;
    const sync = () => {
      void latest.current(shell).then((is) => {
        if (live) setFlag(is);
      }, () => {});
    };
    sync();
    const stop = shell.onResized(sync).catch(() => () => {});
    return () => {
      live = false;
      void stop.then((unlisten) => unlisten());
    };
  }, []);
  return flag;
}

export function WindowControls({ className }: { className?: string }) {
  // The window can be maximized without these buttons — a double-click on the
  // bar, the Win+Up shortcut, a snap gesture — so the glyph follows the
  // window's own state rather than what was last clicked here.
  const maximized = useWindowFlag((shell) => shell.isMaximized());

  // Houdini's help pane owns its own frame. Drawing these there gives the
  // reader three buttons that do nothing. macOS draws its traffic lights.
  const shown = appWindow() !== null && !IS_MAC;

  const MaximizeGlyph = maximized ? Icons.captionRestore : Icons.captionMaximize;

  if (!shown) return null;

  return (
    <div className={cn("flex h-full items-center", className)}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Minimize"
        className={CAPTION_BUTTON}
        onClick={(() => void appWindow()?.minimize())}
      >
        <Icons.captionMinimize className="size-glyph" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label={maximized ? "Restore" : "Maximize"}
        className={CAPTION_BUTTON}
        onClick={(() => void appWindow()?.toggleMaximize())}
      >
        <MaximizeGlyph className="size-glyph" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className={cn(
          CAPTION_BUTTON,
          // The one coloured control in the chrome, and the platform's own
          // convention: red fill, white glyph, in both themes.
          "pointer-hover:bg-window-close pointer-hover:text-white active:bg-window-close/85",
        )}
        onClick={(() => void appWindow()?.close())}
      >
        <Icons.captionClose className="size-glyph" />
      </button>
    </div>
  );
}
