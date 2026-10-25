/**
 * The Houdini the app is reading, and the size of its documentation.
 *
 * Both the sidebar and the landing hero name the build, so the read happens
 * once here rather than in each of them. The titles are already cached for the
 * session by `lib/search.ts`, so asking for the page count costs nothing after
 * the first ask.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke, inTauri, listen } from "./backend";
import { titles, forgetTitles } from "@/lib/search";

export interface Install {
  version: string;
  root: string;
  help: string;
}

export interface BuildInfo {
  /** `null` while it is still being read, then the version or an empty string
      when the machine has no Houdini on it. */
  version: string | null;
  pageCount: number | null;
}

/**
 * The reader's own name, for the greeting.
 *
 * The platform gives a login name, so `jane.doe` and `JOHN` both arrive. The
 * greeting wants one word a person recognises: take what comes before the
 * first separator and put one capital on it. An empty answer greets nobody,
 * which is what a machine with no user name deserves.
 */
export function useUserName(): string {
  const [name, setName] = useState("");

  useEffect(() => {
    let live = true;
    void invoke<string>("user_name")
      .catch(() => "")
      .then((raw) => {
        if (live) setName(firstName(raw));
      });
    return () => {
      live = false;
    };
  }, []);

  return name;
}

function firstName(raw: string): string {
  // `DOMAIN\jane.doe` and `JOHN` both arrive, so the domain goes first.
  const account = raw.trim().split("\\").pop() ?? "";
  const word = account.split(/[@._\- ]/)[0] ?? "";
  if (!word) return "";
  // A shouted login is a login, not a name; a mixed one is left alone.
  const rest = word === word.toUpperCase() ? word.slice(1).toLowerCase() : word.slice(1);
  return word.charAt(0).toUpperCase() + rest;
}

/** What the index pass reports. */
export interface IndexStatus {
  build: string;
  /** Pages written so far. */
  pages: number;
  /** Pages the install holds. */
  total: number;
  done: boolean;
  /** True when a pass has written in this process. Only `index_status` says
      it; the events do not carry it, because a view that gets one was there
      for the pass. */
  wrote?: boolean;
}

/**
 * The build and the index pass, as every view sees them: the version, the
 * pages readable now, the pass's last report, and a number that goes up each
 * time the title list is read again. The card, the landing line and the tree
 * all read this one value, so they never show two moments of the same pass.
 */
let index: { build: BuildInfo; status: IndexStatus | null; titles: number } = {
  build: { version: null, pageCount: null },
  status: null,
  titles: 0,
};
const indexListeners = new Set<() => void>();

function setIndex(next: Partial<typeof index>) {
  index = { ...index, ...next };
  for (const notify of indexListeners) notify();
}

/** At most this often, the title list is read again while the pass writes.
    Each read is the whole list and a new tree, so a read per report is work
    the reader cannot see. */
const REREAD_MS = 500;
let lastRead = 0;
let pending: ReturnType<typeof setTimeout> | null = null;

/** The read in flight, or 0. A report that arrives during it is held until the
    titles land, so the count and the share never come from two moments: a
    switch drew the old count beside the new build's share, and the last
    report dropped the share before the last count arrived. */
let reading = 0;
let reads = 0;
let held: IndexStatus | null = null;

/** `status` and `version`, when given, are shown with the titles this read
    brings. */
function rereadTitles(status?: Promise<IndexStatus | null>, version?: Promise<string>) {
  if (pending) clearTimeout(pending);
  pending = null;
  lastRead = Date.now();
  forgetTitles();
  if (status) held = null;
  const mine = (reading = ++reads);
  void Promise.all([titles(), status, version]).then(([all, read, installed]) => {
    if (mine !== reading) return;
    reading = 0;
    const version = installed ?? index.build.version;
    // A report of the build the reader just left (its pass stops a moment
    // after the switch) must not stand beside the new build.
    const next = [held, read].find((one) => one && (!version || one.build === version)) ?? null;
    held = null;
    setIndex({
      titles: index.titles + 1,
      build: { version, pageCount: all.length },
      status: next ?? (index.status && version && index.status.build !== version ? null : index.status),
    });
  });
}

function showStatus(status: IndexStatus) {
  if (reading) held = status;
  else setIndex({ status });
}

/** One report from the pass. Rust sends `done` only after a pass that wrote. */
function report(status: IndexStatus) {
  if (!reading && index.build.version && status.build !== index.build.version) return;
  if (status.done) return rereadTitles(Promise.resolve(status));
  showStatus(status);
  const wait = REREAD_MS - (Date.now() - lastRead);
  if (wait <= 0) rereadTitles();
  else pending ??= setTimeout(rereadTitles, wait);
}

function readStatus(): Promise<IndexStatus | null> {
  const status = invoke<IndexStatus>("index_status").catch(() => null);
  // Houdini's help pane gets no events at all, so it asks again each second
  // while a pass runs.
  void status.then((read) => {
    if (!inTauri && read && !read.done) setTimeout(() => void readStatus().then((next) => next && report(next)), 1000);
  });
  return status;
}

/** The install the reader CHOSE, not the newest one on the machine. */
function readVersion(): Promise<string> {
  return invoke<Install | null>("current_install")
    .catch(() => null)
    .then((install) => install?.version ?? "");
}

let listening = false;

function subscribeIndex(notify: () => void) {
  if (!listening) {
    listening = true;
    void listen<IndexStatus>("index", (event) => report(event.payload));
    void catchUp();
  }
  indexListeners.add(notify);
  return () => indexListeners.delete(notify);
}

/**
 * The state on mount, which the events do not repeat.
 *
 * The pass starts before the window has a page in it, so the reports it made
 * while the webview loaded reached nobody. A pass that also ENDED in that gap
 * left the title list read at boot out of date — empty on a fresh index — and
 * nothing later says so: the window stood at "0 pages" until the reader
 * reloaded it by hand. `wrote` is how Rust says a pass has written in this
 * process, and the list is read again when it has.
 */
async function catchUp() {
  if (index.build.version === null) await primeBuild();
  const status = await readStatus();
  if (!status) return;
  if (status.done && !status.wrote) showStatus(status);
  else report(status);
}

export function useIndex() {
  return useSyncExternalStore(subscribeIndex, () => index);
}

export function useBuild(): BuildInfo {
  return useIndex().build;
}

/** "4,120 pages · 35% indexed" while the pass runs, "12,377 pages" once it is
    done. The count is the pages already readable, so it climbs to the final
    number and never jumps. */
export function pagesLabel(count: number, status: IndexStatus | null): string {
  const pages = `${count.toLocaleString()} pages`;
  const share = indexedShare(status);
  return share ? `${pages} · ${share}` : pages;
}

/** "35% indexed" while a pass runs, `null` once it is done. Never 100: the
    last pages are ones the pass reads and does not list. A pass that has not
    counted the install yet has no share to show, so it says what it is doing
    instead. */
export function indexedShare(status: IndexStatus | null): string | null {
  if (!status || status.done) return null;
  if (status.total === 0) return "indexing…";
  return `${Math.min(99, Math.floor((status.pages / status.total) * 100))}% indexed`;
}

/** Reads the build before the window's first draw, so the card never says
    "reading" or "no install" on the way in. */
export async function primeBuild(): Promise<void> {
  const [version, all] = await Promise.all([readVersion(), titles()]);
  setIndex({ build: { version, pageCount: all.length } });
}

/**
 * Asks the reader for a Houdini folder and reads the build in it.
 *
 * The scan only looks where the installer puts a build, so a studio install on
 * another drive arrives through here. The version picker and the first-launch
 * onboarding both call this, so a folder that works in one works in the other.
 *
 * `false` when the reader closed the picker without choosing. Throws with what
 * to say when the folder holds no help.
 */
export async function pickInstall(): Promise<boolean> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const folder = await open({
    directory: true,
    multiple: false,
    title: "Pick a Houdini install folder",
  });
  if (typeof folder !== "string") return false;
  await invoke("add_install", { path: folder });
  announceBuildChanged();
  return true;
}

const buildListeners = new Set<() => void>();

/** The build this process reads has changed. The store re-reads the version,
    the count and the pass, whether or not a view is watching yet: the setup
    switches the build on a screen that shows neither, and the landing page
    that comes after it must not show the build it was primed with. */
export function announceBuildChanged() {
  rereadTitles(readStatus(), readVersion());
  for (const notify of buildListeners) notify();
}

/** Runs when the version picker switches the build this process reads. The
    reading view uses it to read the open page again out of the new build. */
export function onBuildChanged(run: () => void): () => void {
  buildListeners.add(run);
  return () => buildListeners.delete(run);
}
