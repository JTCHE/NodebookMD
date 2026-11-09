import { invoke } from "./backend";
import { weight } from "./ranking";

/** One matching section of a page — a row nested under it in the list. */
/**
 * An excerpt as the reader sees it. The index keeps the page's markdown, so
 * an excerpt can hold `**density**` or `[Copy to Points](/nodes/sop/copytopoints)`,
 * or half of a link where the snippet cut it.
 */
export function excerptText(excerpt: string): string {
  return untable(excerpt)
    // A tag the page writes as raw HTML (a video, a line break). Only a real
    // tag shape, so `a < b` in code keeps its text.
    .replace(/<\/?[a-z][^<>]*>/gi, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\]\([^)\s]*\)?/g, "")
    .replace(/\*\*|__|`|\[/g, "")
    // A markdown escape or hard line break: `\*`, `floatmax\ The`. A `\n`
    // in code keeps its backslash.
    .replace(/\\(?=[\s\p{P}]|$)/gu, "");
}

/** A table the snippet crossed, as text: its head row and the `| --- |` row
    under it go, and the cells read as a list. `| Parameter | Description | |
    --- | --- | | Input 1 | Choose...` becomes `Input 1 · Choose...`. */
function untable(text: string): string {
  const rule = /(?:\|\s*:?-{3,}:?\s*)+\|/g;
  // A cell edge is a pipe with space or an end on both sides. `a||b` is code
  // and stays. ponytail: `a | b` in code reads as `a · b`; rare in the help.
  if (!/(^|\s)\|(\s|$)/.test(text)) return text;
  let out = text;
  for (let found = rule.exec(out); found; found = rule.exec(out)) {
    // The head row has one pipe more than the rule has cells.
    let pipes = (found[0].match(/-{3,}/g) ?? []).length + 1;
    let start = found.index;
    while (start > 0 && pipes > 0) if (out[--start] === "|") pipes -= 1;
    out = out.slice(0, start) + out.slice(found.index + found[0].length);
    rule.lastIndex = start;
  }
  return out
    .replace(/\s*\|(?:\s*\|)*\s*/g, " · ")
    .replace(/^ · | · $/g, "")
    .replace(/ · …/g, "…");
}

export interface Section {
  /** Empty when the words were above the first heading. */
  heading: string;
  /** The anchor to open the page at. Empty with an empty heading. */
  slug: string;
  excerpt: string;
}

/** A page in the title list, and a search hit. Rust sends one shape for both. */
export interface Hit {
  path: string;
  title: string;
  nodeType?: string | null;
  icon?: string | null;
  summary?: string | null;
  /** Sections that matched, best first. Empty for a title match. */
  headings?: Section[];
  /** How well the words match. Weighted by `weight` below, never used raw. */
  score?: number;
  /** The sidebar folders above the page, below its branch. Only the title
      list carries them; Rust works them out at index time (`place.rs`). */
  place?: string[];
}

const RECENT_SEARCHES_KEY = "nodebookmd:recent-searches";
const MAX_RECENT = 5;

/** The pages the reader last opened from a search, newest first. Both search
    boxes write it, and the overlay lists it before anything is typed. */
export function recentSearches(): Hit[] {
  try {
    return JSON.parse(sessionStorage.getItem(RECENT_SEARCHES_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** The page, never the section the reader entered it by. */
export function rememberSearch(hit: Hit) {
  const page = { ...hit, headings: undefined };
  const updated = [page, ...recentSearches().filter((r) => r.path !== hit.path)].slice(0, MAX_RECENT);
  sessionStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
}

/** Every title in the build, fetched once and kept for the session.
 *
 *  10,450 titles are small, and holding them here is what makes the pick
 *  instant: no round trip while the reader types.
 *  See spec: Local — SQLite FTS5 Index. */
let all: Promise<Hit[]> | null = null;

export function titles(): Promise<Hit[]> {
  all ??= invoke<Hit[]>("titles").catch(() => []);
  return all;
}

/** The title of one page, if the list is already in memory. The list is read
    once per session for the search field, so a lookup here costs nothing and
    never touches Rust. Undefined until that read lands, and for a path the
    index does not hold. */
export function titleOf(path: string): string | undefined {
  return byPath?.get(path)?.title;
}

/** The whole row for one page, on the same terms as `titleOf`. */
export function hitOf(path: string): Hit | undefined {
  return byPath?.get(path);
}

/** Path to title, built once per title list. A breadcrumb asks for two or
    three ancestors on every navigation, and a scan of ten thousand rows for
    each of them is work nobody needs. */
let byPath: Map<string, Hit> | null = null;

export function warmTitleIndex(): Promise<void> {
  return titles().then((all) => {
    if (byPath) return;
    byPath = new Map(all.map((hit) => [hit.path, hit]));
  });
}

/** Drops the cache, so the next read sees what the background pass has added. */
export function forgetTitles() {
  all = null;
  byPath = null;
}

/** Full-text search over the page bodies. Rust ranks it with `bm25()`.
 *
 *  The text ranking comes back as it is and is reordered here by what KIND of
 *  page each hit is. Text scoring alone cannot make that call: the shelf entry
 *  and the node share a title, and the shelf page is shorter, which BM25
 *  actively rewards — so "copy to points" answered with the shelf button
 *  instead of the node. See `weight`. */
export async function bodies(query: string, limit = 6): Promise<Hit[]> {
  // Three times what the caller wants, because reordering can only move a page
  // inside the window it was fetched in, and the node that deserves first place
  // is often outside a window of six.
  const hits = await invoke<Hit[]>("search", { query, limit: limit * 3 }).catch(() => []);
  return hits
    .sort((a, b) => (b.score ?? 0) * weight(b) - (a.score ?? 0) * weight(a))
    .slice(0, limit);
}

/** The section of the docs a path belongs to, as a breadcrumb.
 *
 *  Two parts at most. The first is the shelf the page sits on, the second the
 *  kind of page it is — the same line the site drew under every result, which
 *  is what tells a SOP and a LOP of the same name apart at a glance. */

export function category(hit: Hit): string {
  const [top, second] = hit.path.split("/");
  switch (top) {
    // The node type is already the exact label, "Geometry node"; the line names
    // a family rather than one page, so it is said in the plural.
    case "nodes":
      return hit.nodeType ? `Nodes > ${hit.nodeType}s` : "Nodes";
    case "vex":
      return second === "functions" ? "VEX > Functions" : "VEX";
    // The path says `hom`, the docs say Python. The reader typed "python".
    case "hom":
      return second && second !== "index" ? `Python scripting > ${second}` : "Python scripting";
    case "expressions":
      return "Expression functions";
    case "commands":
      return "HScript commands";
    case "examples":
      return "Examples";
    case "shelf":
      return "Shelf tools";
    case "props":
      return "Properties";
    default:
      return top ? top[0].toUpperCase() + top.slice(1) : "";
  }
}

/** A pasted SideFX link, an app link (`nodebookmd://docs/…`), or a path typed
    by hand, is a page to open outright. */
export function pastedPath(text: string): string {
  return text
    .trim()
    .replace(/^[a-z][\w+.-]*:\/\/(?=docs\/)/i, "")
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[#?].*$/, "")
    .replace(/^\/?docs\/houdini\d*\//, "")
    .replace(/^\/+|\/+$/g, "")
    // SideFX serves `box.html`, and the copied page path is `box.md` (the
    // file an agent reads); the page here is `box`.
    .replace(/\.(html?|md)$/, "");
}

/** The section a pasted link names, as `#anchor`, or nothing. */
export function pastedAnchor(text: string): string {
  return text.trim().match(/#[^#?\s]+$/)?.[0] ?? "";
}

/**
 * The page a pasted link or a typed path names, or null.
 *
 * The title list holds the newest version of each node only, and a SideFX link
 * often names an older one (`nodes/sop/filemerge` beside `filemerge-2.0`). A
 * path the list does not hold is asked of the build itself.
 */
export async function pastedHit(text: string): Promise<Hit | null> {
  const path = pastedPath(text);
  if (!path) return null;
  const listed = (await titles()).find((hit) => hit.path === path);
  if (listed || !path.includes("/")) return listed ?? null;
  const [meta] = await invoke<Hit[]>("meta", { paths: [path] }).catch(() => []);
  return meta ?? null;
}

/**
 * Which page the reader meant by what they typed, or null if nothing does.
 *
 * A path or a pasted link names a page outright. Anything else is a query, and
 * the best row of the list is the answer — the same row Enter opens once they
 * have arrowed onto it. Nothing else navigates: `cptp` with nothing to show
 * must stay on the landing page and say so, not open a page that is not there.
 */
export async function resolve(text: string, best?: Hit): Promise<Hit | null> {
  return (await pastedHit(text)) ?? best ?? null;
}
