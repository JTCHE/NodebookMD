/**
 * The tabs of a desktop window, each with its own back and forward.
 *
 * One router serves every tab. The router reads its location from the active
 * tab and sends every move to `navigator`, which writes it into that tab's
 * trail. A switch of tab is a move like back or forward (`POP`): the shell,
 * the panel and the tree stay mounted, and only the content column changes.
 *
 * Houdini's help pane has no tabs: it keeps the browser's own history, which
 * its own back button walks. See main.tsx.
 */
import { useSyncExternalStore } from "react";
import { createPath, NavigationType, parsePath, type Location, type Navigator, type To } from "react-router";
import { appWindow, inTauri, invoke } from "@/lib/backend";

export interface Tab {
  id: string;
  entries: Location[];
  index: number;
  /** The last move in this tab. A tab the reader switches to reads as POP. */
  action: NavigationType;
}

export interface TabsState {
  tabs: Tab[];
  active: number;
}

/** Only the first window keeps its tabs: a window opened later is a side trip. */
const KEEPS_TABS = appWindow()?.label === "main";
const SAVED = "houdinimd.tabs";
const RESTORE = "houdinimd.restore-tabs";
/** How much of each trail a restart keeps. */
const KEPT_ENTRIES = 30;

const newKey = () => Math.random().toString(36).slice(2, 10);

function entryOf(to: To, state: unknown = null): Location {
  const path = typeof to === "string" ? parsePath(to) : to;
  return { pathname: "/", search: "", hash: "", ...path, state, key: newKey() };
}

function tabOf(entries: Location[], index = entries.length - 1): Tab {
  return { id: newKey(), entries, index, action: NavigationType.Pop };
}

export const current = (tab: Tab) => tab.entries[tab.index];

/** Whether tabs come back after a restart. On unless the reader turned it off. */
export function restoresTabs(): boolean {
  try {
    return localStorage.getItem(RESTORE) !== "false";
  } catch {
    return true;
  }
}

export function setRestoresTabs(on: boolean) {
  localStorage.setItem(RESTORE, String(on));
  if (!on) localStorage.removeItem(SAVED);
  else save();
}

function restored(): TabsState | null {
  if (!KEEPS_TABS || !restoresTabs()) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(SAVED) ?? "null") as {
      tabs: { entries: string[]; index: number }[];
      active: number;
    } | null;
    if (!saved?.tabs?.length) return null;
    const tabs = saved.tabs.map((tab) => tabOf(tab.entries.map((path) => entryOf(path)), tab.index));
    if (tabs.some((tab) => !current(tab))) return null;
    return { tabs, active: Math.min(Math.max(saved.active, 0), tabs.length - 1) };
  } catch {
    return null;
  }
}

function fresh(): TabsState {
  const { pathname, search, hash } = window.location;
  return { tabs: [tabOf([entryOf({ pathname, search, hash })])], active: 0 };
}

let state: TabsState = restored() ?? fresh();
if (inTauri) {
  window.history.replaceState(null, "", createPath(current(state.tabs[state.active])));
  // Code that moves the address by itself — the harness, a devtools line —
  // moves the active tab there, as it moved the page before there were tabs.
  window.addEventListener("popstate", () => {
    const { pathname, search, hash } = window.location;
    const path = `${pathname}${search}${hash}`;
    if (path !== createPath(current(state.tabs[state.active]))) navigator.push(path);
  });
}
// A window opened by a tear-off gets the trail of its tab, which the
// window's address alone does not carry.
if (inTauri && !KEEPS_TABS) {
  void invoke<SavedTab | null>("take_tab")
    .then((tab) => {
      if (tab) set({ tabs: [tabOfSaved(tab)], active: 0 });
    })
    .catch(() => {});
}
const listeners = new Set<() => void>();
/** Tabs closed in this session, last one first, for Ctrl+Shift+T. */
const closed: { tab: Tab; at: number }[] = [];
/** Tabs opened in the background from the active one since the reader last
    moved. Each next one goes after them, so they keep the order they were
    opened in — what a browser does. */
let openedBehind = 0;

function save() {
  if (!KEEPS_TABS || !restoresTabs()) return;
  const tabs = state.tabs.map((tab) => {
    const from = Math.max(0, tab.index + 1 - KEPT_ENTRIES);
    const entries = tab.entries.slice(from, from + KEPT_ENTRIES).map((entry) => createPath(entry));
    return { entries, index: tab.index - from };
  });
  try {
    localStorage.setItem(SAVED, JSON.stringify({ tabs, active: state.active }));
  } catch {
    // Full or blocked storage costs the restore, not the window.
  }
}

function set(next: TabsState) {
  state = next;
  save();
  // The address stays the page on screen, for code that reads it. There is
  // only ever one entry, so the webview's own back key has nowhere to go.
  window.history.replaceState(null, "", createPath(current(state.tabs[state.active])));
  for (const listener of listeners) listener();
}

function setActiveTab(change: (tab: Tab) => Tab) {
  openedBehind = 0;
  set({ ...state, tabs: state.tabs.map((tab, i) => (i === state.active ? change(tab) : tab)) });
}

export function useTabs(): TabsState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export const tabsState = () => state;

/** What the router calls to move. It always moves the active tab. */
export const navigator: Navigator = {
  createHref: (to) => (typeof to === "string" ? to : createPath(to)),
  push(to, entryState) {
    setActiveTab((tab) => {
      const entries = [...tab.entries.slice(0, tab.index + 1), entryOf(to, entryState)];
      return { ...tab, entries, index: entries.length - 1, action: NavigationType.Push };
    });
  },
  replace(to, entryState) {
    setActiveTab((tab) => {
      const entries = tab.entries.map((entry, i) => (i === tab.index ? entryOf(to, entryState) : entry));
      return { ...tab, entries, action: NavigationType.Replace };
    });
  },
  go(delta) {
    const tab = state.tabs[state.active];
    const index = Math.min(Math.max(tab.index + delta, 0), tab.entries.length - 1);
    if (index !== tab.index) setActiveTab(() => ({ ...tab, index, action: NavigationType.Pop }));
  },
};

/** Opens `path` in a new tab after the active one. In the background, the
    reader stays where they are. `entryState` goes with the entry, as a
    navigation's state does. */
/** A blank tab, at the home page, at the end of the strip — as Ctrl+T does
    in a browser. */
export function newTab() {
  openedBehind = 0;
  set({ tabs: [...state.tabs, tabOf([entryOf("/")])], active: state.tabs.length });
}

export function openTab(path: string, { background = false, entryState }: { background?: boolean; entryState?: unknown } = {}) {
  const at = state.active + 1 + (background ? openedBehind : 0);
  const tabs = [...state.tabs];
  tabs.splice(at, 0, tabOf([entryOf(path, entryState)]));
  const keepBehind = background ? openedBehind + 1 : 0;
  set({ tabs, active: background ? state.active : at });
  openedBehind = keepBehind;
}

/**
 * Where a pick in a list opens, from the keys held with it: null for here, or
 * a new tab. Ctrl or ⌘ with a click opens it behind, so the reader can open
 * several and stay in the list; with Shift, or with Enter, it comes to the
 * front. The desktop window only.
 */
export function tabFor(event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, byKey = false): { background: boolean } | null {
  if (!inTauri || !(event.ctrlKey || event.metaKey)) return null;
  return { background: !byKey && !event.shiftKey };
}

export function activateTab(index: number) {
  if (index === state.active || !state.tabs[index]) return;
  openedBehind = 0;
  set({
    active: index,
    tabs: state.tabs.map((tab, i) => (i === index ? { ...tab, action: NavigationType.Pop } : tab)),
  });
}

/** Moves to the next tab (1) or the one before (-1), round the ends. */
export function cycleTab(step: 1 | -1) {
  const count = state.tabs.length;
  activateTab((state.active + step + count) % count);
}

/** Closes the tabs `which` names. The last tab closes the window. */
export function closeTabs(which: (index: number) => boolean) {
  const kept = state.tabs.filter((_, i) => !which(i));
  if (!kept.length) return closeWindow();
  state.tabs.forEach((tab, at) => {
    if (which(at)) closed.unshift({ tab, at });
  });
  closed.splice(20);
  // The active tab stays active if it stays. Else the one to its right takes
  // its place, as in a browser, or the one to its left at the end.
  let active = kept.indexOf(state.tabs[state.active]);
  if (active < 0) {
    const right = state.tabs.slice(state.active + 1).find((tab) => kept.includes(tab));
    active = right ? kept.indexOf(right) : kept.length - 1;
  }
  openedBehind = 0;
  set({ tabs: kept, active });
}

/** Closes the window, all its tabs with it: Ctrl+Shift+W. The main window
    hides to the tray when the reader keeps it running. */
export function closeWindow() {
  void invoke("close_window").catch(() => {});
}

export const closeTab = (index: number) => closeTabs((i) => i === index);

export const canReopenTab = () => closed.length > 0;

export function reopenTab() {
  const last = closed.shift();
  if (!last) return;
  const at = Math.min(last.at, state.tabs.length);
  const tabs = [...state.tabs];
  tabs.splice(at, 0, { ...last.tab, action: NavigationType.Pop });
  openedBehind = 0;
  set({ tabs, active: at });
}

export function duplicateTab(index: number) {
  const tab = state.tabs[index];
  const tabs = [...state.tabs];
  tabs.splice(index + 1, 0, tabOf(tab.entries.map((entry) => ({ ...entry, key: newKey() })), tab.index));
  openedBehind = 0;
  set({ tabs, active: index + 1 });
}

/** Puts the tab at `from` in place `to`, for a drag along the strip. */
export function moveTab(from: number, to: number) {
  if (from === to) return;
  const tabs = [...state.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(to, 0, tab);
  const activeTab = state.tabs[state.active];
  set({ tabs, active: tabs.indexOf(activeTab) });
}

/** A tab as it travels to another window: its trail as paths. */
export interface SavedTab {
  entries: string[];
  index: number;
}

export function tabData(index: number): SavedTab {
  const tab = state.tabs[index];
  return { entries: tab.entries.map((entry) => createPath(entry)), index: tab.index };
}

function tabOfSaved(saved: SavedTab): Tab {
  return tabOf(saved.entries.map((path) => entryOf(path)), Math.min(Math.max(saved.index, 0), saved.entries.length - 1));
}

/** A tab that came from another window, at place `at`, in front. */
export function insertTab(saved: SavedTab, at: number) {
  const tabs = [...state.tabs];
  const place = Math.min(Math.max(at, 0), tabs.length);
  tabs.splice(place, 0, tabOfSaved(saved));
  openedBehind = 0;
  set({ tabs, active: place });
}

/** A tab that left for another window. It is not closed, so Ctrl+Shift+T
    does not bring it back. The last one takes the window with it. */
export function removeTab(index: number) {
  if (state.tabs.length === 1) return closeWindow();
  const tabs = state.tabs.filter((_, i) => i !== index);
  const active = index < state.active ? state.active - 1 : Math.min(state.active, tabs.length - 1);
  openedBehind = 0;
  set({ tabs, active });
}

/** Where back and forward lead in the active tab. */
export function trailOf(tab: Tab) {
  return { canGoBack: tab.index > 0, canGoForward: tab.index < tab.entries.length - 1 };
}
