/**
 * The tabs of the window, in the title bar. Drawn once there are two: a
 * single tab is the window itself, and a lone chip would only take room.
 *
 * Motion stays out of the reader's way. A switch is instant — it happens
 * dozens of times an hour. Only a change of place moves: a tab that opens
 * fades in, and the tabs beside one that closes or is dragged slide to their
 * new place, so the eye can follow where each one went. After a close by
 * pointer the tabs keep their width until the pointer leaves the strip, so
 * the next close button lands under the pointer, as in a browser.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { CopyPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { inTauri } from "@/lib/backend";
import { Icons } from "@/lib/ui/icons";
import { Hint } from "@/components/ui/Hint";
import { MenuList } from "@/components/ui/MenuList";
import DocIconClient from "@/components/docs/markdown/DocIconClient";
import { COMMAND_KEY, IS_MAC, useHotkey } from "@/lib/hotkeys";
import { hitOf } from "@/lib/search";
import { useLibrary } from "@/lib/store/library";
import {
  activateTab,
  canReopenTab,
  closeTab,
  closeTabs,
  current,
  cycleTab,
  duplicateTab,
  moveTab,
  newTab,
  reopenTab,
  tabsState,
  useTabs,
  type Tab,
} from "@/lib/tabs";

export const NEW_TAB_KEYS = `${COMMAND_KEY}+T`;
export const CLOSE_TAB_KEYS = `${COMMAND_KEY}+W`;
export const REOPEN_TAB_KEYS = IS_MAC ? "⇧+⌘+T" : "Ctrl+Shift+T";

/** The slide of the tabs that change place: short, and it decelerates. */
const SLIDE = { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" };
/** The width a tab takes when the bar has room. */
const TAB_WIDTH = 184;
/** Pixels a press travels before it is a drag and not a click. */
const DRAG_START = 4;

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The keys of a browser's tabs. The desktop window only: Houdini's pane
    has one page. */
export function useTabKeys() {
  useHotkey((event) => {
    const command = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!inTauri || !command || event.altKey) return;
    const { tabs, active } = tabsState();
    const run = (action: () => void) => {
      event.preventDefault();
      action();
    };
    // `code` for the letters and digits: the key a layout types there varies.
    if (event.code === "KeyT") run(event.shiftKey ? reopenTab : newTab);
    else if (event.code === "KeyW" && !event.shiftKey) run(() => closeTab(active));
    else if (event.key === "Tab") run(() => cycleTab(event.shiftKey ? -1 : 1));
    else if (event.key === "PageDown" && !event.shiftKey) run(() => cycleTab(1));
    else if (event.key === "PageUp" && !event.shiftKey) run(() => cycleTab(-1));
    else if (IS_MAC && event.shiftKey && event.code === "BracketRight") run(() => cycleTab(1));
    else if (IS_MAC && event.shiftKey && event.code === "BracketLeft") run(() => cycleTab(-1));
    else if (/^Digit[1-9]$/.test(event.code) && !event.shiftKey) {
      // 1 to 8 name a place; 9 is the last tab, however many there are.
      const digit = Number(event.code.slice(5));
      run(() => activateTab(digit === 9 ? tabs.length - 1 : digit - 1));
    }
  });
}

/** Name and icon of the page a tab shows: the visit the page wrote when it
    drew, else the title list, else the last part of the path. */
function useLabel(tab: Tab): { title: string; icon?: string } {
  const { recents } = useLibrary();
  const path = current(tab).pathname.replace(/^\/+/, "");
  if (!path) return { title: "Home" };
  const visit = recents.find((entry) => entry.path === path);
  if (visit) return visit;
  const hit = hitOf(path);
  if (hit) return { title: hit.title, icon: hit.icon ?? undefined };
  const last = path.split("/").pop() ?? path;
  return { title: last.charAt(0).toUpperCase() + last.slice(1) };
}

export function TabStrip() {
  const { tabs, active } = useTabs();
  const strip = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  /** The width each tab keeps after a close by pointer, until it leaves. */
  const [frozen, setFrozen] = useState<number | null>(null);

  // Where each tab sat at the last change, by id, so a tab that moved can
  // start from its old place. `offsetLeft` ignores the slide in flight.
  const places = useRef(new Map<string, number>());
  const measure = () => {
    const now = new Map<string, number>();
    for (const el of strip.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? []) now.set(el.dataset.tab!, el.offsetLeft);
    return now;
  };
  useLayoutEffect(() => {
    const before = places.current;
    const now = measure();
    places.current = now;
    if (!before.size || still()) return;
    for (const el of strip.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? []) {
      // The dragged tab stays under the pointer, wherever its place now is.
      if (el.dataset.drag) {
        el.style.transform = `translateX(${Number(el.dataset.drag) - el.offsetLeft}px)`;
        continue;
      }
      const from = before.get(el.dataset.tab!);
      const to = now.get(el.dataset.tab!)!;
      if (from === undefined) {
        el.animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], SLIDE);
      } else if (from !== to) {
        el.animate([{ transform: `translateX(${from - to}px)` }, { transform: "none" }], SLIDE);
      }
    }
  }, [tabs, frozen]);
  // A window that changes width moves every tab without a change to slide.
  useEffect(() => {
    const box = strip.current;
    if (!box) return;
    const watch = new ResizeObserver(() => (places.current = measure()));
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  function close(index: number) {
    if (index < tabs.length - 1) {
      const width = strip.current?.querySelector<HTMLElement>(`[data-tab="${tabs[index].id}"]`)?.offsetWidth;
      if (width) setFrozen(width);
    }
    closeTab(index);
  }

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Tabs"
      onPointerLeave={() => setFrozen(null)}
      // Each tab is a size container, which gives it no width of its own to
      // offer the row, so the strip asks for the room its tabs want.
      style={{ flexBasis: tabs.length * (TAB_WIDTH + 4) + 28 }}
      className={cn(
        // Relative: each tab's `offsetLeft` is then its place in the strip.
        "relative ml-xs flex h-full min-w-0 items-center gap-2xs",
        "transition-opacity duration-(--duration-fast) starting:opacity-0 motion-reduce:transition-none",
      )}
    >
      {tabs.map((tab, index) => (
        <TabChip
          key={tab.id}
          tab={tab}
          index={index}
          active={index === active}
          width={frozen}
          strip={strip}
          onClose={() => close(index)}
          onMenu={(x, y) => setMenu({ x, y, index })}
        />
      ))}
      <Hint label="New tab" keys={NEW_TAB_KEYS}>
        <button
          type="button"
          tabIndex={-1}
          aria-label="New tab"
          onClick={newTab}
          className={cn(
            "grid size-[24px] shrink-0 cursor-interactive place-items-center rounded-md text-neutral-600",
            "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
            "pointer-hover:bg-neutral-200 pointer-hover:text-neutral-900 active:bg-neutral-300",
          )}
        >
          <Icons.newTab className="size-[15px]" />
        </button>
      </Hint>
      {menu && <TabMenu {...menu} count={tabs.length} onClose={() => setMenu(null)} />}
    </div>
  );
}

function TabChip({
  tab,
  index,
  active,
  width,
  strip,
  onClose,
  onMenu,
}: {
  tab: Tab;
  index: number;
  active: boolean;
  width: number | null;
  strip: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { title, icon } = useLabel(tab);
  const chip = useRef<HTMLDivElement>(null);

  /** A press activates at once. A press that travels drags the tab along
      the strip, and it swaps places with each tab whose middle it crosses. */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button === 1) {
      // The middle button closes. Its press would start the page's autoscroll.
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    activateTab(index);
    const el = chip.current!;
    const box = strip.current!;
    const grab = event.clientX - el.getBoundingClientRect().left;
    const startX = event.clientX;
    let dragging = false;
    // On the window, not captured by the tab: a swap moves the tab in the
    // DOM, and a moved element loses its capture.

    const move = (moved: PointerEvent) => {
      if (!dragging && Math.abs(moved.clientX - startX) < DRAG_START) return;
      if (!dragging) {
        dragging = true;
        for (const running of el.getAnimations()) running.cancel();
      }
      const chips = [...box.querySelectorAll<HTMLElement>("[data-tab]")];
      const from = chips.indexOf(el);
      const left = box.getBoundingClientRect().left;
      // Kept in the strip: a tab dragged past either end stops there.
      const first = chips[0].offsetLeft;
      const last = chips[chips.length - 1].offsetLeft + chips[chips.length - 1].offsetWidth - el.offsetWidth;
      const x = Math.min(Math.max(moved.clientX - grab - left, first), last);
      const middle = x + el.offsetWidth / 2;
      let to = from;
      // At or past a neighbour's middle: a tab held against the end reaches it.
      while (to < chips.length - 1 && middle >= chips[to + 1].offsetLeft + chips[to + 1].offsetWidth / 2) to++;
      while (to > 0 && middle <= chips[to - 1].offsetLeft + chips[to - 1].offsetWidth / 2) to--;
      el.dataset.drag = String(x);
      el.style.transform = `translateX(${x - el.offsetLeft}px)`;
      // The strip draws the swap now, so the next move reads the new order,
      // and puts the tab back under the pointer.
      if (to !== from) flushSync(() => moveTab(from, to));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!dragging) return;
      const settle = el.style.transform;
      el.style.transform = "";
      delete el.dataset.drag;
      if (settle && !still()) el.animate([{ transform: settle }, { transform: "none" }], SLIDE);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  const style = (width ? { flex: `0 0 ${width}px` } : { "--tab": `${TAB_WIDTH}px` }) as CSSProperties;

  return (
    <div
      ref={chip}
      data-tab={tab.id}
      role="tab"
      aria-selected={active}
      onPointerDown={onPointerDown}
      onAuxClick={(event) => {
        if (event.button === 1) onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      style={style}
      className={cn(
        // Wide enough for a name, and every tab gives way alike when the bar
        // runs short. Below the width of icon and close, the name goes.
        "group/tab @container relative flex h-[26px] min-w-[36px] shrink basis-(--tab) cursor-interactive items-center gap-[6px] rounded-md pr-[3px] pl-[8px]",
        "touch-none select-none",
        "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
        active
          ? "bg-raised text-neutral-950 shadow-chip"
          : "text-neutral-600 pointer-hover:bg-neutral-200/70 pointer-hover:text-neutral-900",
      )}
    >
      {/* A narrow tab keeps its icon; the active one keeps its close. */}
      <span className={cn("grid shrink-0 place-items-center", active && "@max-[40px]:hidden")}>
        {icon ? (
          <DocIconClient src={icon} alt="" className="size-[14px]" fallback={<Icons.page className="size-[14px]" />} />
        ) : title === "Home" ? (
          <Icons.home className="size-[14px]" />
        ) : (
          <Icons.page className="size-[14px]" />
        )}
      </span>
      <span className="min-w-0 flex-1 translate-y-[0.5px] truncate text-[12px] leading-none @max-[44px]:hidden">{title}</span>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Close ${title}`}
        // The press would also reach the tab, which activates and drags.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onClose}
        className={cn(
          "grid size-[20px] shrink-0 place-items-center rounded-[4px] text-neutral-500",
          "transition-[opacity,background-color,color] duration-(--duration-fast) motion-reduce:transition-none",
          "pointer-hover:bg-neutral-300/70 pointer-hover:text-neutral-950",
          // The active tab always shows its close; another only under the
          // pointer, and a narrow one never, so its icon keeps the room.
          active ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100 @max-[64px]:hidden",
        )}
      >
        <Icons.dismiss className="size-[12px]" />
      </button>
    </div>
  );
}

function TabMenu({ x, y, index, count, onClose }: { x: number; y: number; index: number; count: number; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [onClose]);
  return (
    <MenuList
      ref={panel}
      label="Tab"
      onClose={onClose}
      style={{ top: y, left: x }}
      className="fixed z-50 min-w-52"
      groups={[
        [
          { label: "New tab", icon: Icons.newTab, keys: NEW_TAB_KEYS, run: newTab },
          { label: "Duplicate", icon: CopyPlus, run: () => duplicateTab(index) },
        ],
        [
          { label: "Close", icon: Icons.dismiss, keys: CLOSE_TAB_KEYS, run: () => closeTab(index) },
          { label: "Close other tabs", icon: Icons.dismiss, disabled: count < 2, run: () => closeTabs((i) => i !== index) },
          { label: "Close tabs to the right", icon: Icons.dismiss, disabled: index === count - 1, run: () => closeTabs((i) => i > index) },
        ],
        [{ label: "Reopen closed tab", icon: Icons.recent, keys: REOPEN_TAB_KEYS, disabled: !canReopenTab(), run: reopenTab }],
      ]}
    />
  );
}
