import { invoke } from "./backend";

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

const RECENT_SEARCHES_KEY = "houdinimd:recent-searches";
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
    case "hscript":
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

/**
 * SideFX keeps the superseded version of a node at a trailing-dash slug —
 * `copytopoints-` is v1, `copytopoints` is "Copy to Points 2.0". The old one is
 * still worth finding, never worth ranking first.
 */
const SUPERSEDED = /-$/;

/**
 * What kind of page this is, from 0 to 1.
 *
 * Someone searching "copy points" wants the NODE. An example is a file that
 * uses it and a shelf entry is a button that runs it; both are worth showing,
 * below the thing itself. An index page lists pages and is almost never the
 * page the reader meant.
 */
function weight(hit: Hit): number {
  const path = hit.path;
  if (path.startsWith("examples/") || path.includes("/examples/")) return 0.55;
  if (path.endsWith("/index") || path === "index") return 0.6;
  if (path.startsWith("shelf/")) return 0.7;
  if (SUPERSEDED.test(path)) return 0.8;
  // Every node context is a reference page, but a name shared between contexts
  // ("Attribute Wrangle" is a SOP, a LOP and a COP) has to break the tie
  // somehow, and SOPs are what most readers are in.
  if (path.startsWith("nodes/sop/")) return 1;
  if (/^(nodes|vex|expressions|hscript|hom)\//.test(path)) return 0.97;
  return 0.9;
}

/**
 * One page, with everything the matcher needs already worked out.
 *
 * This exists for one reason: the matcher runs over every page in the build on
 * every keystroke. Lower-casing the path and the title there cost 29ms for a
 * single letter — a keystroke that misses two frames before the letter itself
 * appears. None of it depends on what was typed, so none of it belongs in the
 * loop. See spec: Local — Performance Harness and Budgets.
 */
interface Ready {
  hit: Hit;
  path: string;
  title: string;
  /** The last part of the path, which is the page's own name. */
  leaf: string;
  /** The title with its spaces taken out, to compare against a slug. */
  packed: string;
  /** `title path`, for the words-in-any-order tier. */
  text: string;
  weight: number;
  rank: number;
  /** The folded title and leaf, for the abbreviation pass. Worked out on
   *  first use and only for the families that pass can match. */
  fold: { title: Folded; leaf: Folded } | null;
  folded: boolean;
}

/**
 * The prepared list for a title list, kept for as long as the list itself is.
 *
 * Weak, so dropping the titles drops this with them: `forgetTitles` is what
 * runs when the background pass adds pages, and a prepared list that outlived
 * its pages would answer with pages that no longer exist.
 */
const prepared = new WeakMap<Hit[], Ready[]>();

function ready(hits: Hit[]): Ready[] {
  let rows = prepared.get(hits);
  if (rows) return rows;
  rows = hits.map((hit) => {
    const path = hit.path.toLowerCase();
    const title = hit.title.toLowerCase();
    return {
      hit,
      path,
      title,
      leaf: path.slice(path.lastIndexOf("/") + 1),
      packed: title.replace(/\s+/g, ""),
      text: `${title} ${path}`,
      weight: weight(hit),
      rank: rank(hit),
      fold: null,
      folded: false,
    };
  });
  prepared.set(hits, rows);
  return rows;
}

/** How well a title or path answers what was typed. 0 means it does not.
 *
 *  The ladder is the order a reader means things: the path they typed, the
 *  name they typed, then the same as a beginning, then the same anywhere.
 *
 *  `tight` is the query with its spaces taken out, worked out once by the
 *  caller: someone typing "copy to points" is naming `copytopoints` exactly,
 *  and comparing as written left that page at the substring tier under the LOP
 *  of the same title. */
function score(row: Ready, query: string, tight: string, words: string[]): number {
  if (row.path === query) return 1000;
  if (row.leaf === tight || row.packed === tight) return 900;
  if (row.leaf.startsWith(tight) || row.packed.startsWith(tight)) return 700;
  if (row.path.startsWith(query)) return 600;
  if (row.title.includes(query)) return 400;
  if (row.path.includes(query)) return 300;

  // Words in any order: "points copy" still finds Copy to Points.
  return words.length > 1 && words.every((word) => row.text.includes(word)) ? 200 : 0;
}

/** The reader is looking for a node far more often than a shelf tool, and for
 *  a page far more often than the index that lists it. */
function rank(hit: Hit): number {
  const section = hit.path.split("/")[0];
  const depth = hit.path.endsWith("/index") ? 1 : 0;
  const order = ["nodes", "vex", "hom", "expressions", "props"].indexOf(section);
  return (order === -1 ? 9 : order) + depth * 10;
}

/** Below this, an abbreviation matches so much of the corpus it means nothing. */
const MIN_ABBREVIATION = 3;

/**
 * At and above this score the query NAMED the page — it is the path, the title,
 * or the beginning of one. Below it the letters merely appear somewhere, which
 * is a far weaker reading than an abbreviation of the same letters.
 */
const NAMED = 600;

/** The fast pick, straight out of the in-memory list. */
export function match(hits: Hit[], query: string, limit = 8): Hit[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  const rows = ready(hits);
  const tight = wanted.replace(/\s+/g, "");
  const words = wanted.split(/\s+/).filter(Boolean);

  // Scored once and the score KEPT. The abbreviation gate below asks which
  // hits named the page, and asking that by scoring the list a second time
  // doubled the cost of every keystroke.
  const hit: Array<{ row: Ready; score: number }> = [];
  let named = 0;
  for (const row of rows) {
    const value = score(row, wanted, tight, words);
    if (value === 0) continue;
    if (value >= NAMED) named++;
    hit.push({ row, score: value });
  }
  hit.sort(
    // Weight breaks a tie the text cannot: "Copy to Points" is the exact title
    // of a SOP and of a LOP, and both are the same length, so without this the
    // answer is whichever the corpus happened to list first.
    (a, b) =>
      b.score - a.score ||
      b.row.weight - a.row.weight ||
      a.row.rank - b.row.rank ||
      a.row.path.length - b.row.path.length,
  );
  const scored = hit.map((row) => row.row.hit);

  // Letter-mashing, the way Houdini's TAB menu takes it: `cptp` for Copy to
  // Points. It runs when nothing NAMED the page, and ahead of the body search,
  // because the abbreviation is the stronger reading of a query with no spaces.
  //
  // "Nothing named it" is not "nothing matched at all". `adpr` is a substring
  // of `hom/hou/loadPreferences` — lo**adpr**eferences — so a pass gated on an
  // empty list never runs, and the reader keeps a Python method instead of
  // Adaptive Prune. The weak hits still follow, under the abbreviations.
  if (named === 0 && !/\s/.test(wanted) && wanted.length >= MIN_ABBREVIATION) {
    const guessed = abbreviated(rows, wanted, limit);
    const seen = new Set(guessed.map((hit) => hit.path));
    return [...guessed, ...scored.filter((hit) => !seen.has(hit.path))].slice(0, limit);
  }
  return scored.slice(0, limit);
}

/**
 * Page families the abbreviation pass is allowed to match.
 *
 * Someone mashing letters is reaching for a thing with a name — a node, a VEX
 * function, an HScript command. Over 11,000 pages, four letters in order match
 * almost anything: `atwr` alone hits `hapi.createWorkItem` and a destruction
 * tutorial before it reaches Attribute Wrangle. Houdini's own TAB menu only
 * ever searches nodes, which is why the matcher behaves there; the families
 * here are that same idea, widened to the scripting references.
 */
const ABBREVIATION_FAMILY = /^(nodes|vex|expressions|hscript|hom)\//;

/**
 * `cptp` should find "Copy to Points" the way it does in Houdini's own TAB
 * menu — letters in order, gaps allowed.
 *
 * Weight multiplies the score rather than breaking ties. As a tiebreak it would
 * never fire: two float scores are almost never exactly equal, so a superseded
 * page would outrank the current one whenever it matched a hair tighter.
 */
function abbreviated(rows: Ready[], query: string, limit: number): Hit[] {
  const scored: Array<{ hit: Hit; score: number }> = [];
  for (const row of rows) {
    if (!row.folded) {
      row.folded = true;
      // The trailing version goes: nobody abbreviates the "2.0" in "Copy to
      // Points 2.0", and counting it as name length lost that SOP to the LOP
      // of the same name, whose title carries no version at all.
      row.fold =
        ABBREVIATION_FAMILY.test(row.hit.path) && !row.hit.path.endsWith("/index")
          ? {
              title: fold(row.hit.title.replace(/\s+\d+(\.\d+)*$/, "")),
              leaf: fold(row.hit.path.slice(row.hit.path.lastIndexOf("/") + 1)),
            }
          : null;
    }
    if (!row.fold) continue;
    const title = subsequence(query, row.fold.title);
    const leaf = subsequence(query, row.fold.leaf);
    if (title === null && leaf === null) continue;
    scored.push({ hit: row.hit, score: Math.max(title ?? 0, leaf ?? 0) * row.weight });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.hit);
}

/**
 * A name reduced to its letters and digits, remembering which of them start a
 * word. "Copy to Points 2.0" folds to `copytopoints20` with `C`, `t`, `P` and
 * `2` flagged; `createWorkitem` folds to itself with `c` and `W` flagged.
 *
 * Word starts are the whole point of the fold. They are what tells an
 * abbreviation apart from an accident — see `subsequence`.
 */
/** A name reduced to its letters, and which of them start a word. */
interface Folded {
  chars: string;
  starts: boolean[];
}

function fold(text: string): Folded {
  let chars = "";
  const starts: boolean[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!/[a-zA-Z0-9]/.test(ch)) continue;
    const previous = i > 0 ? text[i - 1] : "";
    starts.push(
      chars.length === 0 ||
        !/[a-zA-Z0-9]/.test(previous) ||
        (ch >= "A" && ch <= "Z" && previous === previous.toLowerCase()),
    );
    chars += ch.toLowerCase();
  }
  return { chars, starts };
}

/**
 * How well `query` abbreviates `name`, from 0 to 1, or `null` for no match.
 *
 * Three rules, and the first is the one that matters. The match must BEGIN at a
 * word start. People abbreviate from the fronts of words — `adpr` is
 * **Ad**aptive **Pr**une — so a run that begins mid-word is a coincidence, not
 * an abbreviation. Without this rule `adpr` returns "Delayed Load Procedural",
 * because lo**adpr**ocedural holds the letters with no gaps at all and so beats
 * the page the reader meant on every other measure.
 *
 * The rest orders what survives. Density (`query / span`) rewards a tight run;
 * coverage (`query / name`) rewards the query accounting for most of the name,
 * which is what separates `copytopoints` from
 * `geoutils::copytopointstargetattribs` when `cptp` spans 7 characters in both.
 * The word-start share then lifts a true abbreviation over a tighter accident.
 *
 * Every window is scored, not just the shortest, because the shortest window
 * and the best-aligned one are often not the same.
 */
function subsequence(query: string, name: Folded): number | null {
  const { chars, starts } = name;
  if (chars.length < query.length) return null;
  let best: number | null = null;

  for (let from = 0; from < chars.length; ) {
    let qi = 0;
    let end = from;
    for (; end < chars.length && qi < query.length; end++) {
      if (chars[end] === query[qi]) qi++;
    }
    if (qi < query.length) break; // no complete match remains
    end--;

    // Pull the start inward to the tightest window with this end.
    let qk = query.length - 1;
    let start = end;
    for (; start >= 0 && qk >= 0; start--) {
      if (chars[start] === query[qk]) qk--;
    }
    start++;

    if (starts[start]) {
      let onStart = 0;
      let qj = 0;
      for (let i = start; i <= end && qj < query.length; i++) {
        if (chars[i] !== query[qj]) continue;
        if (starts[i]) onStart++;
        qj++;
      }
      const density = query.length / (end - start + 1);
      const coverage = query.length / chars.length;
      const value = density * coverage * (1 + onStart / query.length);
      if (best === null || value > best) best = value;
    }

    from = start + 1;
  }

  return best;
}

/** A pasted SideFX link, or a path typed by hand, is a page to open outright. */
export function pastedPath(text: string): string {
  return text
    .trim()
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
