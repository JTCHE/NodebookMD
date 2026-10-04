/**
 * Pages already read, and the one the pointer is over.
 *
 * A reader walks back and forth over a handful of pages — a node, the function
 * it names, back to the node — and every one of those steps used to be a fresh
 * read and parse. From here they are free.
 *
 * The cap is what a walk like that reaches, not what a session reaches: holding
 * every page a long session opens would hold most of the corpus in memory, and
 * the pages beyond the last few are not the ones being walked.
 *
 * `warm` is the other half. Reading a page costs 100–350ms of zip and parse,
 * and the pointer spends longer than that travelling to the row it is going to
 * press. Starting the read when the pointer arrives, rather than when the
 * button goes down, is what makes the page look like it was already open.
 */
import type { Root } from "hast";
import { invoke } from "./backend";
import { warmRows } from "./landing/tree";
import { warmIcons } from "./icons";
import { hitOf } from "./search";
import { parse } from "./markdown/parse";

export interface PageView {
  path: string;
  name: string;
  nodeType?: string;
  icon?: string;
  since?: string;
  summary?: string;
  markdown: string;
  /** The body as plain Markdown, for copy, save and Obsidian. See
      `portable` in the wiki crate's markdown.rs. */
  portable: string;
  version: string;
  /** Every version of this node, newest first. Empty for a page with no
      other version. See `versions.rs`. */
  nodeVersions: NodeVersion[];
  /** The markdown parsed, off the main thread. Set by `read`; only the last
      few pages keep it. */
  tree?: Root;
}

export interface NodeVersion {
  path: string;
  label: string;
}

export interface PageError {
  missing: boolean;
  message: string;
}

const READ = new Map<string, PageView>();
const KEEP = 30;
/** Pages that keep their parsed tree. A long page's tree is megabytes; a page
    further back parses again, in the worker. */
const TREES = 8;
/** How long a page waits for its panel icons. An icon loads in about 7ms on an
    idle window; this is room for a busy one, and no more. */
const ICON_WAIT = 80;
/** Reads under way, so a pointer that wanders over a row twice reads once. */
const READING = new Map<string, Promise<PageView>>();

/** A page ready to draw now: read, and parsed. */
export function known(path: string): PageView | undefined {
  const view = READ.get(path);
  return view?.tree ? view : undefined;
}

function remember(path: string, page: PageView) {
  READ.delete(path);
  READ.set(path, page);
  if (READ.size > KEEP) READ.delete(READ.keys().next().value!);
  let trees = 0;
  for (const [key, view] of [...READ].reverse()) {
    if (view.tree && ++trees > TREES) READ.set(key, { ...view, tree: undefined });
  }
}

export function read(path: string): Promise<PageView> {
  const held = READING.get(path);
  if (held) return held;
  // The panel's icons for this page load while the page does, and the page
  // waits for them and for the icons of its own links, up to a cap. A page
  // that came back first was drawn first: the webview put the icons behind
  // that render, and the rows and the links drew empty.
  const rows = warmRows(path);
  const kept = READ.get(path);
  const reading = (kept ? Promise.resolve(kept) : invoke<PageView>("page", { path }))
    .then((view) =>
      Promise.all([
        view.tree ?? parse(view.path, view.markdown),
        Promise.race([
          Promise.all([rows, warmIcons(linkIcons(view.markdown))]),
          new Promise((done) => setTimeout(done, ICON_WAIT)),
        ]),
      ]).then(([tree]) => ({ ...view, tree })),
    )
    .then((view) => {
      remember(path, view);
      return view;
    })
    .finally(() => {
      READING.delete(path);
    });
  READING.set(path, reading);
  return reading;
}

/** The icons of the first pages a page links to: the links on screen when it
    opens. Not all of them — a list of functions links to hundreds. */
function linkIcons(markdown: string): string[] {
  const icons = new Set<string>();
  for (const [, to] of markdown.matchAll(/\]\(\/([^)#\s]+)/g)) {
    const icon = hitOf(to)?.icon;
    if (icon) icons.add(icon);
    if (icons.size === 40) break;
  }
  return [...icons];
}

/** Drops every page held here. The cache is keyed by path alone, because a
    process reads one build at a time — so switching the build makes all of it
    wrong at once, and the next read has to go back to Rust. */
export function forgetPages() {
  READ.clear();
  // A read already under way is reading the OLD build, so it is dropped from
  // the dedup map too. Its own `finally` may then delete a key the next read
  // put there, which costs one duplicate read and never a wrong page.
  READING.clear();
}

/** Start reading a page nobody has asked for yet. A failure here is not the
    reader's business — they have not pressed anything — so it is swallowed
    and the real navigation reports it. */
export function warm(path: string) {
  if (known(path) || READING.has(path)) return;
  void read(path).catch(() => {});
}
