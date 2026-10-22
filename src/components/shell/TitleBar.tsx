/**
 * The window's own bar: what the app is, where the reader has been, and the
 * three buttons that own the window.
 *
 * The bar IS the drag region — `data-tauri-drag-region` on the row, so any
 * gap between the controls moves the window, the way a system title bar does.
 * Every control inside it stops that: a button that also dragged the window
 * would swallow the click.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { useTrail } from "@/lib/nav";
import { WindowControls, useWindowFlag } from "./WindowControls";
import { TitleBarMenu } from "./TitleBarMenu";
import { TabStrip, useTabKeys } from "./TabStrip";
import { appWindow, inTauri, invoke } from "@/lib/backend";
import { ALT_KEY, BACK_KEYS, COMMAND_KEY, FORWARD_KEYS, IS_MAC, historyStep, letterOf, useHotkey } from "@/lib/hotkeys";
import { Hint } from "@/components/ui/Hint";
import { APP_NAME } from "@/lib/brand";
import { version } from "../../../src-tauri/tauri.conf.json";

/* A square icon button on the bar. Smaller than a caption button and rounded,
   because it belongs to the app rather than to the window. */
const BAR_BUTTON =
  "grid size-[28px] shrink-0 cursor-interactive place-items-center rounded-md text-neutral-700 " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:not-disabled:bg-neutral-200 active:not-disabled:bg-neutral-300 " +
  "disabled:text-neutral-400 disabled:pointer-events-none " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface TitleBarProps {
  /** Whether the sidebar is open, and how to change that. */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  /** True on a doc page. The landing page shows the arrows only once there
      is a trail to walk — on the first launch there is none, and two dead
      arrows on an empty window say nothing. */
  showTrail: boolean;
  /** The bar over the first-launch setup: the name and the window's own
      buttons, and nothing that opens a part of the app the reader has not
      set up yet. */
  bare?: boolean;
}

export function TitleBar({ sidebarOpen, onToggleSidebar, showTrail, bare = false }: TitleBarProps) {
  const navigate = useNavigate();
  const { canGoBack, canGoForward } = useTrail();
  const tabbed = inTauri && !bare;
  // With tabs the arrows stay put, or the strip after them would jump
  // sideways on every switch to or from a home tab.
  const showArrows = !bare && (showTrail || canGoBack || canGoForward || tabbed);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  // Read before the menu opens, so its server row is there on the first frame.
  // 0 when the server never started.
  const [port, setPort] = useState(0);
  useEffect(() => {
    if (inTauri) void invoke<number>("server_port").catch(() => 0).then(setPort);
  }, []);
  // macOS hides the traffic lights in full screen, and the room kept for
  // them goes with them.
  const fullscreen = useWindowFlag((shell) => shell.isFullscreen());
  const nativeFrame = IS_MAC && appWindow() !== null;
  useHotkey((event) => {
    const step = historyStep(event);
    if (!step) return;
    event.preventDefault();
    if (step < 0 ? canGoBack : canGoForward) void navigate(step);
  });
  // The mouse's own back and forward buttons. The webview has no history of
  // its own to walk: the trails live in the tabs.
  useEffect(() => {
    if (!inTauri) return;
    const onButton = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      void navigate(event.button === 3 ? -1 : 1);
    };
    window.addEventListener("mouseup", onButton);
    return () => window.removeEventListener("mouseup", onButton);
  }, [navigate]);
  useTabKeys();

  return (
    <header
      data-tauri-drag-region
      className={cn(
        // No gap on the row itself: the caption buttons have to reach the
        // window's right edge, and a row gap would leave a strip of bar
        // beside the close button that no click can ever hit.
        "flex h-titlebar shrink-0 items-center print:hidden",
        // The sidebar button is concentric with the window's corner: 2px from
        // the top of the 32px bar, so 2px from the left too, and its 6px
        // radius is the window's 8px less that inset.
        bare ? "pl-sm" : "pl-[2px]",
        // macOS draws its traffic lights over the left of the bar, and no
        // caption buttons sit at the right edge.
        nativeFrame && !fullscreen && "pl-[80px]",
        nativeFrame && "pr-xs",
        // The hairline is drawn INSIDE the bar. A border would take a pixel
        // off the row, and the caption buttons would stop a pixel short of
        // the bottom of the window's own bar. It is a layer over the bar's
        // contents, so the tabs sit behind it, as they do in a browser.
        "relative bg-neutral-50 select-none",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-20 after:h-px after:bg-(--hairline)",
      )}
    >
      {!bare && (
      <Hint label={sidebarOpen ? "Hide the sidebar" : "Show the sidebar"} keys={`${COMMAND_KEY}+B`}>
      <button
        type="button"
        tabIndex={-1}
        aria-label={sidebarOpen ? "Hide the sidebar" : "Show the sidebar"}
        aria-pressed={sidebarOpen}
        // The floating panel closes on a press outside it; this press is the
        // button's own, and must toggle it instead.
        data-sidebar-toggle=""
        className={BAR_BUTTON}
        onClick={(onToggleSidebar)}
      >
        <Icons.sidebarToggle className="size-4" />
      </button>
      </Hint>
      )}

      {/* The name is the way home, the way a window title is in every app
          that has a home to go to. */}
      <Hint label="Home. Right-click for the app menu">
      <Link
        to="/"
        tabIndex={-1}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        className={cn(
          // Same plate as BAR_BUTTON: 28px tall, same radius, same hover fill.
          // Only the horizontal padding differs, because a logo and a word
          // need more room than one glyph. A whole-pixel width: the text is a
          // fraction wide, and the arrows after it drew soft on half pixels.
          "ml-sm flex h-[28px] w-[117px] shrink-0 cursor-interactive items-center gap-[6px] rounded-md px-sm",
          // A narrow window with tabs gives the name's room to the tabs.
          tabbed && "max-[760px]:w-auto",
          "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
          "pointer-hover:bg-neutral-200",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <BrandLogo className="h-[16px] w-auto shrink-0" />
        <span className={cn("translate-y-[0.5px] text-[12.5px] font-medium tracking-[-0.01em] text-neutral-950", tabbed && "max-[760px]:hidden")}>
          {APP_NAME}
        </span>
      </Link>
      </Hint>

      {/* The arrows say where the trail leads before they are pressed: a
          disabled arrow is the honest answer to "is there a page behind this
          one", and it never moves, so the bar does not reflow as the reader
          walks. They are absent on the landing page, which has no trail. */}
      {showArrows && (
        // 16px, not 15: an odd size in the 28px plate sat on a half pixel.
        <span className="ml-xs flex shrink-0 items-center gap-2xs">
          <Hint label="Back" keys={BACK_KEYS}>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Back"
              disabled={!canGoBack}
              className={BAR_BUTTON}
              onClick={(() => void navigate(-1))}
            >
              <Icons.back className="size-4 -translate-y-px" />
            </button>
          </Hint>
          <Hint label="Forward" keys={FORWARD_KEYS}>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Forward"
              disabled={!canGoForward}
              className={BAR_BUTTON}
              onClick={(() => void navigate(1))}
            >
              <Icons.forward className="size-4 -translate-y-px" />
            </button>
          </Hint>
        </span>
      )}

      {tabbed && <TabStrip />}

      {/* The stretch between the app's controls and the window's is the part of
          the bar a reader grabs to move the window. */}
      {/* Never all taken by tabs: a bar with no gap cannot be dragged. */}
      <span
        data-tauri-drag-region
        className="h-full min-w-[48px] flex-1"
      />

      {/* Which build of the app this is, beside the window's own buttons:
          it is read, not pressed, and the arrows stay next to the name. */}
      <span data-tauri-drag-region className={cn("mr-sm shrink-0 translate-y-[0.5px] text-caption text-neutral-500", tabbed && "max-[760px]:hidden")}>
        v{version}
      </span>

      <PinButton />
      <WindowControls />

      {menuAt && <TitleBarMenu at={menuAt} port={port} onClose={() => setMenuAt(null)} />}
    </header>
  );
}

/** Keeps the window over every other one, Houdini's included, so the page
    stays in sight while the reader works. Only in the app's own window: the
    help pane is a panel inside Houdini. It lasts until the window closes.
    Ctrl+Alt+T does the same from the keyboard. */
function PinButton() {
  const [pinned, setPinned] = useState(false);
  const toggle = () => {
    const next = !pinned;
    void appWindow()
      ?.setAlwaysOnTop(next)
      .then(() => setPinned(next))
      .catch(() => {});
  };
  useHotkey((event) => {
    if (letterOf(event) !== "t" || !(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return;
    event.preventDefault();
    toggle();
  });
  if (!appWindow()) return null;
  return (
    <Hint label={pinned ? "Stop keeping on top" : "Keep on top"} keys={`${COMMAND_KEY}+${ALT_KEY}+T`}>
    <button
      type="button"
      tabIndex={-1}
      aria-label={pinned ? "Stop keeping on top" : "Keep on top"}
      aria-pressed={pinned}
      className={cn(BAR_BUTTON, pinned && "text-brand")}
      onClick={toggle}
    >
      <Icons.pin className={cn("size-[13px]", pinned && "fill-current")} />
    </button>
    </Hint>
  );
}
