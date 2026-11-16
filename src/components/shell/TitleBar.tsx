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
import { CAPTION_BUTTON, WindowControls, useWindowFlag } from "./WindowControls";
import { TitleBarMenu } from "./TitleBarMenu";
import { TabStrip, useTabKeys } from "./TabStrip";
import { appWindow, inTauri, invoke } from "@/lib/backend";
import { ALT_KEY, BACK_KEYS, COMMAND_KEY, FORWARD_KEYS, IS_MAC, historyStep, letterOf, useHotkey } from "@/lib/hotkeys";
import { Hint } from "@/components/ui/Hint";
import { BAR_BUTTON } from "@/lib/ui/button";
import { APP_NAME } from "@/lib/brand";

interface TitleBarProps {
  /** The panel sits beside the sheet, so the bar keeps its width over it. */
  docked: boolean;
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

export function TitleBar({ docked, sidebarOpen, onToggleSidebar, showTrail, bare = false }: TitleBarProps) {
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
        "relative z-20 flex h-titlebar shrink-0 items-center bg-chrome select-none print:hidden",
        // macOS draws its traffic lights over the left of the bar, and no
        // caption buttons sit at the right edge.
        nativeFrame && "pr-xs",
      )}
    >
      {/* The panel's part of the bar. Docked, it is exactly as wide as the
          panel (`--sidebar-width`, set by the panel), so the tabs start on
          the sheet's left edge. Its controls sit on the panel's axis: the
          toggle's glyph is over the panel's text, 16px in. */}
      <div
        data-tauri-drag-region
        style={docked ? { width: "var(--sidebar-width)" } : undefined}
        className={cn(
          // A size container only while it has a stated width: as one, its
          // contents no longer give it a width of their own.
          docked && "@container",
          // 4px from the window edge, as from the top: the button corner is then
          // concentric with the window corner.
          "flex h-full shrink-0 items-center pl-[4px]",
          nativeFrame && !fullscreen && "pl-[80px]",
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
          className={cn(BAR_BUTTON, !nativeFrame && "rounded-tl-[4px]")}
          onClick={onToggleSidebar}
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
            // Same plate as BAR_BUTTON: 28px tall, same radius, same hover.
            // Its padding is given back, so the logo sits 8px after the toggle.
            "flex h-[28px] shrink-0 cursor-interactive items-center gap-[7px] rounded-md px-sm",
            bare ? "-ml-2xs" : "ml-2xs",
            "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
            "pointer-hover:bg-neutral-200 active:bg-neutral-300",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          )}
        >
          <BrandLogo className="h-icon w-auto shrink-0" />
          {/* A narrow panel keeps the logo and gives the word's room to the
              arrows. */}
          <span className={cn("translate-y-light text-meta font-medium tracking-[-0.015em] text-neutral-900", !bare && "@max-[236px]:hidden")}>
            {APP_NAME}
          </span>
        </Link>
        </Hint>

        {/* The arrows close the panel's part of the bar, right against the
            sheet, so the tabs after them start on the sheet's edge. A
            disabled arrow is the honest answer to "is there a page behind
            this one", and it never moves, so the bar does not reflow as the
            reader walks. */}
        {showArrows && (
          <span className={cn("flex shrink-0 items-center", docked ? "mr-xs ml-auto" : "mx-xs")}>
            <Hint label="Back" keys={BACK_KEYS}>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Back"
                disabled={!canGoBack}
                className={BAR_BUTTON}
                onClick={() => void navigate(-1)}
              >
                <Icons.back className="size-4" />
              </button>
            </Hint>
            <Hint label="Forward" keys={FORWARD_KEYS}>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Forward"
                disabled={!canGoForward}
                className={BAR_BUTTON}
                onClick={() => void navigate(1)}
              >
                <Icons.forward className="size-4" />
              </button>
            </Hint>
          </span>
        )}
      </div>

      {tabbed && <TabStrip />}

      {/* The stretch between the app's controls and the window's is the part
          of the bar a reader grabs to move the window. Never all taken by
          tabs: a bar with no gap cannot be dragged. */}
      <span
        data-tauri-drag-region
        className="h-full min-w-[48px] flex-1"
      />

      <SearchButton />
      <PinButton corner={nativeFrame && !fullscreen} />
      <WindowControls />

      {menuAt && <TitleBarMenu at={menuAt} port={port} onClose={() => setMenuAt(null)} />}
    </header>
  );
}

/** Opens the search, for a reader who does not know the shortcut. It
    presses the shortcut itself, so the search on a page and the field on
    the home page each answer it as they answer the key. */
function SearchButton() {
  const press = () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  return (
    <Hint label="Search" keys={`${COMMAND_KEY}+K`} className="h-full">
      <button type="button" tabIndex={-1} aria-label="Search" className={CAPTION_BUTTON} onMouseDown={(event) => event.preventDefault()} onClick={press}>
        <Icons.search className="size-glyph" />
      </button>
    </Hint>
  );
}

/** Keeps the window over every other one, Houdini's included, so the page
    stays in sight while the reader works. Only in the app's own window: the
    help pane is a panel inside Houdini. It lasts until the window closes.
    Ctrl+Alt+T does the same from the keyboard. */
function PinButton({ corner }: { corner: boolean }) {
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
    <Hint label={pinned ? "Stop keeping on top" : "Keep on top"} keys={`${COMMAND_KEY}+${ALT_KEY}+T`} className="h-full">
    <button
      type="button"
      tabIndex={-1}
      aria-label={pinned ? "Stop keeping on top" : "Keep on top"}
      aria-pressed={pinned}
      className={cn(CAPTION_BUTTON, corner && "rounded-tr-xl", pinned && "text-brand")}
      onClick={toggle}
    >
      {/* Drawn as a caption button: the same box, ink and glyph size as the
          three beside it, so the four read as one set. */}
      <Icons.pin className={cn("size-glyph", pinned && "fill-current")} />
    </button>
    </Hint>
  );
}
