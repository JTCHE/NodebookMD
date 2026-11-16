/**
 * What the reader has read, and what they kept.
 *
 * Both lists hold the same thing — a page, by the little the UI needs to draw
 * a row for it — so they are one module and one shape. Recents are written by
 * the reading view on every page it opens; bookmarks are written only when the
 * reader asks.
 *
 * The store lives in `user.db`, behind `backend.ts`, so the desktop window
 * and Houdini's help pane — two different origins — read and write the same
 * rows. See spec: Local — User config shared between the window and the help
 * pane.
 *
 * A write updates the in-memory copy at once, so the surface that made it
 * never waits on a round trip. The OTHER surface only learns of it on its own
 * next poll, which runs on window focus: the reader notices a change made
 * elsewhere on the way back to the window that shows it, never mid-glance.
 */
import { useSyncExternalStore } from "react";
import { invoke } from "../backend";
import { used } from "@/lib/telemetry";

export interface LibraryEntry {
  /** Which visit this is. A recent has one; a bookmark does not, because a
      page is kept once and `path` names it. */
  id?: number;
  /** Help path, as the router and `page` read it: `nodes/sop/attribwrangle`. */
  path: string;
  title: string;
  /** Icon path inside `icons.zip`, e.g. `SOP/attribwrangle.svg`. */
  icon?: string;
  /** Epoch milliseconds — when it was last read, or when it was kept. */
  at: number;
}

/** What a Rust `library::Entry` serialises to: `icon` is `null`, not absent. */
interface WireEntry {
  id?: number;
  path: string;
  title: string;
  icon: string | null;
  at: number;
}

function fromWire(entries: WireEntry[]): LibraryEntry[] {
  return entries.map(({ id, path, title, icon, at }) => ({ id, path, title, icon: icon ?? undefined, at }));
}

const listeners = new Set<() => void>();

let snapshot: { recents: LibraryEntry[]; bookmarks: LibraryEntry[] } = { recents: [], bookmarks: [] };

function commit(next: typeof snapshot) {
  snapshot = next;
  for (const notify of listeners) notify();
}

/** Reads both lists off the backend and replaces the in-memory copy. */
async function load() {
  const [recents, bookmarks] = await Promise.all([
    invoke<WireEntry[]>("recents").catch(() => []),
    invoke<WireEntry[]>("bookmarks").catch(() => []),
  ]);
  commit({ recents: fromWire(recents), bookmarks: fromWire(bookmarks) });
}

/** The first read, so the window can wait for it before it draws. */
export const libraryLoaded = load();

// The window has Tauri events for this; the help pane has neither an origin
// in common with the window nor a push channel of its own, so both poll the
// one signal they do share: the reader bringing this surface to the front.
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => void load());
}

export function recents(): LibraryEntry[] {
  return snapshot.recents;
}

export function bookmarks(): LibraryEntry[] {
  return snapshot.bookmarks;
}

/** Records one visit to a page. A page already in the trail moves to the top
    with a fresh time instead of getting a second line: the trail is the pages
    the reader has read, most recent first, not a log of every visit.

    A page with no name is not recorded at all: a row the reader cannot read
    is worse than a trail one page short.

    The row goes in optimistically with no `id`, because the id is the
    backend's to give. Once `record_visit` resolves, the row is patched in
    with its real id so `forget` works on it right away, without waiting for
    the next focus poll. */
export function recordVisit(entry: Omit<LibraryEntry, "at">) {
  if (!entry.title.trim()) return;
  const at = Date.now();
  const without = snapshot.recents.filter((existing) => existing.path !== entry.path);
  commit({ ...snapshot, recents: [{ ...entry, at }, ...without] });
  void invoke<number>("record_visit", { path: entry.path, title: entry.title, icon: entry.icon, at }).then((id) => {
    commit({
      ...snapshot,
      recents: snapshot.recents.map((existing) => (existing.path === entry.path && existing.at === at ? { ...existing, id } : existing)),
    });
  });
}

/** Drops one VISIT from the trail. The trail is the reader's, so they get to
    take a line out of it — one line, not every visit to that page. */
export function forget(id: number) {
  commit({ ...snapshot, recents: snapshot.recents.filter((entry) => entry.id !== id) });
  void invoke("forget_recent", { id });
}

/** Empties the trail, or the kept pages. */
export async function clearLibrary(bookmarks: boolean) {
  commit(bookmarks ? { ...snapshot, bookmarks: [] } : { ...snapshot, recents: [] });
  await invoke("clear_library", { bookmarks });
}

export function isBookmarked(path: string): boolean {
  return snapshot.bookmarks.some((entry) => entry.path === path);
}

/** Keeps a page, or lets it go. Returns what the page is after the call. */
export function toggleBookmark(entry: Omit<LibraryEntry, "at">): boolean {
  const willKeep = !isBookmarked(entry.path);
  used("bookmark");
  const at = Date.now();
  const without = snapshot.bookmarks.filter((existing) => existing.path !== entry.path);
  commit({ ...snapshot, bookmarks: willKeep ? [{ ...entry, at }, ...without] : without });
  void invoke("toggle_bookmark", { path: entry.path, title: entry.title, icon: entry.icon, at });
  return willKeep;
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The library, live. Re-renders the caller when either list changes. */
export function useLibrary() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in the width a row has for it: `12m`, `2h`, `yest.`, `12 Mar`.
 *
 * Deliberately not `Intl.RelativeTimeFormat` — that writes "12 minutes ago",
 * which is three times the width the column holds.
 */
export function shortAgo(at: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 2 * DAY) return "yest.";
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
