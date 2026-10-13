/**
 * The window: a title bar, a panel, and whatever is being read.
 *
 * Both routes render inside this, so the panel and the bar do not remount when
 * the reader opens a page — the tree keeps the branches they opened, and the
 * window keeps its scroll.
 *
 * The shell owns the window's height and never scrolls. Only the content
 * column does, which is what keeps the bar at the top and the keys at the
 * bottom no matter how long a page is.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { invoke, inTauri } from "@/lib/backend";
import { known, read } from "@/lib/pages";
import { primeBuild } from "@/lib/install";
import { titles, warmTitleIndex } from "@/lib/search";
import { treeOf } from "@/lib/landing/tree";
import { bookmarks, libraryLoaded } from "@/lib/store/library";
import { warmIcons } from "@/lib/icons";
import { isCommand, isTyping, useHotkey } from "@/lib/hotkeys";
import { Onboarding, useOnboarding } from "@/components/onboarding/Onboarding";
import { Lightbox } from "@/components/docs/Lightbox";
import { ContextMenu } from "./ContextMenu";
import { TitleBar } from "./TitleBar";
import { Sidebar, storedWidth } from "./Sidebar";
import { REVEAL } from "./sidebar/PageTree";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { StatusBar } from "./StatusBar";

/**
 * The first stop of the Tab key: past the title bar and the panel, straight
 * to what is being read. On the home page that is the search field; on a page
 * it is the page, so the next Tab reaches its first link and the arrows scroll.
 */
function SkipToContent() {
  return (
    <a
      href="#content"
      onClick={(event) => {
        event.preventDefault();
        const main = document.querySelector<HTMLElement>("main");
        (main?.querySelector<HTMLElement>("input") ?? main)?.focus({ preventScroll: true });
      }}
      className={cn(
        "sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-[4px] focus-visible:left-sm focus-visible:z-50",
        "rounded-md bg-raised text-meta font-medium text-neutral-950 shadow-chip focus-visible:px-ms focus-visible:py-xs",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      )}
    >
      Skip to content
    </a>
  );
}

/** The page needs this much width beside the panel, or its lines wrap every
    few words. Below it the panel leaves the row and floats over the page. */
const PAGE_MIN = 600;

/** The longest the window waits to draw itself whole. A normal start takes a
    fraction of it. */
const BOOT_WAIT = 1000;

function onResize(change: () => void) {
  window.addEventListener("resize", change);
  return () => window.removeEventListener("resize", change);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  // Closed by default inside Houdini's help pane: that window is small, and
  // giving the page its full width back matters more there than in the
  // desktop window, which has room to spare. The reader can still open it.
  const [sidebarOpen, setSidebarOpen] = useState(inTauri);
  // The setup owns the window until it is done. It is read from the settings,
  // so the window draws neither the app nor the setup for that first moment
  // rather than flashing the one it turns out not to need.
  const { show: onboarding, finish } = useOnboarding();

  /* A narrow window hides the panel, whatever the reader chose, and the
     choice comes back when the window widens. Opened while narrow, the panel
     is a card over the page: it takes the page's width only while it is in
     use, and a page link, a press outside it or Escape puts it away. */
  const tight = useSyncExternalStore(onResize, () => window.innerWidth < storedWidth() + PAGE_MIN);
  const [floating, setFloating] = useState(false);
  const path = location.pathname.replace(/^\/+/, "");
  useEffect(() => setFloating(false), [tight, path]);
  // The panel marks the page on screen, not the address: it moves in the same
  // frame as the article, and not a read ahead of it. The wait is also what
  // gives the icons of a far branch time to load — see `warmRows`.
  const [shown, setShown] = useState(path);
  useEffect(() => {
    if (!path || known(path)) return setShown(path);
    let live = true;
    read(path)
      .catch(() => {})
      .finally(() => live && setShown(path));
    return () => {
      live = false;
    };
  }, [path]);
  // The window draws once, whole. Drawn as each read came back, it arrived in
  // four steps: a card that said "no install", then the page with no icons and
  // an empty panel, then the tree and a new breadcrumb, then the icons. The
  // wait has a cap, so a slow read shows what is in rather than nothing.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const tree = titles().then((all) => {
      treeOf(all);
      // After the tree, so the read can load the panel's icons with it.
      if (path) return read(path).then(() => {});
    });
    // More than the bookmark strip shows, and far fewer than a reader keeps.
    const kept = libraryLoaded.then(() => warmIcons(bookmarks().slice(0, 8).flatMap((entry) => (entry.icon ? [entry.icon] : []))));
    const reads = Promise.all([primeBuild(), tree, warmTitleIndex(), kept]);
    void Promise.race([reads, new Promise((done) => setTimeout(done, BOOT_WAIT))])
      .catch(() => {})
      .then(() => setReady(true));
    // The first path only: this is the way in, not every page.
  }, []);
  const toggleSidebar = () => (tight ? setFloating((open) => !open) : setSidebarOpen((open) => !open));

  useEffect(() => {
    const show = () => (tight ? setFloating(true) : setSidebarOpen(true));
    window.addEventListener(REVEAL, show);
    return () => window.removeEventListener(REVEAL, show);
  }, [tight]);

  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!floating) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (card.current?.contains(target) || target.closest("[data-sidebar-toggle]")) return;
      setFloating(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [floating]);
  useHotkey((event) => {
    if (event.key === "Escape" && floating) setFloating(false);
  });

  // ⌘B shows and hides the panel, the shortcut every editor with a panel
  // uses for it.
  useHotkey((event) => {
    if (event.key !== "b" || !isCommand(event) || event.shiftKey) return;
    if (isTyping(event.target)) return;
    event.preventDefault();
    toggleSidebar();
  });

  // ⌘N opens one more window, as in a browser. Only the desktop app makes
  // windows: in Houdini's pane the key stays Qt's.
  useHotkey((event) => {
    if (!inTauri || event.key.toLowerCase() !== "n" || !isCommand(event) || event.shiftKey) return;
    event.preventDefault();
    void invoke("new_window").catch(() => {});
  });

  // ⌘W closes this window, as in a browser. The first window hides to the
  // tray, the same as its close button.
  useHotkey((event) => {
    if (!inTauri || event.key.toLowerCase() !== "w" || !isCommand(event) || event.shiftKey) return;
    event.preventDefault();
    void invoke("close_window").catch(() => {});
  });

  const onLanding = path === "";

  return (
    // A print is the page alone, at its full length: the window's own height,
    // its bars and its panel stay on the screen.
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground print:block print:h-auto print:overflow-visible">
      <SkipToContent />
      <TitleBar
        sidebarOpen={tight ? floating : sidebarOpen}
        onToggleSidebar={toggleSidebar}
        showTrail={!onLanding}
        bare={onboarding === true}
      />

      {(onboarding === null || !ready) && <div className="flex-1" />}
      {ready && onboarding === true && <Onboarding onDone={finish} />}
      {ready && onboarding === false && (
      <div className="relative flex min-h-0 flex-1 print:block">
        {!tight && sidebarOpen && <Sidebar currentPath={shown || undefined} className="print:hidden" />}
        {tight && floating && (
          <div
            ref={card}
            className={cn(
              "absolute inset-y-sm left-sm z-30 print:hidden",
              // Slides in from the edge it belongs to, once, on opening.
              "transition-[opacity,translate] duration-(--duration-fast) ease-out motion-reduce:transition-none",
              "starting:-translate-x-2 starting:opacity-0",
            )}
          >
            <Sidebar floating currentPath={shown || undefined} />
          </div>
        )}

        <div className={cn("relative flex min-w-0 flex-1 flex-col overflow-hidden print:block print:overflow-visible")}>
          {children}
          {/* The strip lies over the bottom of the page, which runs on under
              it and fades out (see .status-scrim), so the page needs room for
              it at its own foot. Only its contents take the pointer: the
              scrollbar under it still drags. */}
          <StatusBar className="pointer-events-none absolute inset-x-0 bottom-0 z-10 print:hidden [&>*]:pointer-events-auto" />
        </div>
        <Lightbox />
        <ContextMenu />
        <SettingsDialog />
      </div>
      )}
    </div>
  );
}
