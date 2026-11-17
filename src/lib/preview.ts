/**
 * The top of a page, for a home card. A card window shows a handful of
 * blocks, so only the head of the markdown is parsed, and nothing waits for
 * icons. The result is small, so it is kept on disk: the next launch draws
 * the cards from storage, with no read at all. A build switch drops it.
 */
import type { Root, RootContent } from "hast";
import { invoke } from "./backend";
import { known, type PageView } from "./pages";
import { parse } from "./markdown/parse";
import { onBuildChanged } from "./install";

export type Preview = Pick<PageView, "path" | "name" | "nodeType" | "icon" | "summary"> & { tree: Root };

/** Enough blocks to fill a card window; the rest is never seen. */
const BLOCKS = 8;
/** Characters of markdown that hold more blocks than a window shows. */
const HEAD = 4000;
const STORAGE_KEY = "nodebookmd.previews.2";
/** Cards on disk: more than the home list shows. */
const STORED_LIMIT = 60;

type Block = { type: string; tagName?: string; properties?: { className?: unknown }; children?: unknown[]; position?: unknown };

/** True when the block is, or wraps, a code block or a code panel. A dark
    slab under the foot fade reads as a smear, so the window skips it. */
function holdsCode(node: Block): boolean {
  if (node.tagName === "pre") return true;
  const classes = node.properties?.className;
  if (Array.isArray(classes) && classes.some((name) => String(name).includes("code-panel") || String(name).includes("vex-signature"))) return true;
  return (node.children ?? []).some((child) => holdsCode(child as Block));
}

function text(node: unknown): string {
  const element = node as { value?: string; children?: unknown[] };
  return element.value ?? (element.children ?? []).map(text).join("");
}

/** The card prints the summary, so a paragraph that repeats it goes. */
function head(tree: Root, summary?: string): Root {
  const said = summary?.replace(/\s+/g, " ").trim().slice(0, 40);
  const repeats = (block: RootContent) => !!said && (block as Block).tagName === "p" && text(block).replace(/\s+/g, " ").trim().startsWith(said);
  return { type: "root", children: tree.children.filter((block) => !holdsCode(block as Block) && !repeats(block)).slice(0, BLOCKS) };
}

function load(): Record<string, Preview> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const stored = load();
const reading = new Map<string, Promise<Preview>>();

function keep(preview: Preview) {
  delete stored[preview.path];
  stored[preview.path] = preview;
  const paths = Object.keys(stored);
  for (const path of paths.slice(0, Math.max(0, paths.length - STORED_LIMIT))) delete stored[path];
  // Without positions the tree is a third of the size.
  const text = JSON.stringify(stored, (key, value) => (key === "position" ? undefined : value));
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {}
}

/** A preview ready to draw now, from memory, storage, or an open page. */
export function storedPreview(path: string): Preview | undefined {
  if (stored[path]) return stored[path];
  const page = known(path);
  return page?.tree ? { ...page, tree: head(page.tree, page.summary) } : undefined;
}

/** Reads at once. The cards ask top first, so the first row draws first
    instead of every card waiting on the whole list. */
const AT_ONCE = 3;
let running = 0;
const waiting: Array<() => void> = [];

function slot<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<void>((start) => {
    if (running < AT_ONCE) start();
    else waiting.push(start);
  }).then(() => {
    running++;
    return work().finally(() => {
      running--;
      waiting.shift()?.();
    });
  });
}

export function preview(path: string): Promise<Preview> {
  const ready = storedPreview(path);
  if (ready) return Promise.resolve(ready);
  let held = reading.get(path);
  if (!held) {
    // Quiet: a card is not a page the reader opened, for the telemetry.
    held = slot(() => invoke<PageView>("page", { path, quiet: true })).then(async (view) => {
      const cut = view.markdown.lastIndexOf("\n\n", HEAD);
      const markdown = view.markdown.length > HEAD && cut > 0 ? view.markdown.slice(0, cut) : view.markdown;
      const tree = head(await parse(view.path, markdown), view.summary);
      const result: Preview = { path, name: view.name, nodeType: view.nodeType, icon: view.icon, summary: view.summary, tree };
      keep(result);
      return result;
    });
    held.finally(() => reading.delete(path)).catch(() => {});
    reading.set(path, held);
  }
  return held;
}

onBuildChanged(() => {
  for (const path of Object.keys(stored)) delete stored[path];
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
});
