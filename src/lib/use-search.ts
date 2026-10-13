import { useEffect, useState } from "react";
import { bodies, match, titles, type Hit } from "@/lib/search";
import { parseScope, scopeTest, type Scope } from "@/lib/scope";
import { recents } from "@/lib/store/library";

/** The body search waits this long after the last key. The title pick does not
 *  wait at all — it reads a list that is already in memory. */
export const BODY_SEARCH_DELAY = 120;

/**
 * Shorter than this, the body search does not run at all.
 *
 * One letter matches most of the corpus, and FTS5 has to rank all of it: the
 * measured cost is 202ms on this machine and 635ms on the reference laptop
 * while Houdini works, against 28ms for a real word. It buys nothing either —
 * the title list already answers a letter instantly, and BM25 over a one-letter
 * prefix ranks noise. See spec: Local — Performance Harness and Budgets.
 */
const MIN_BODY_QUERY = 3;

/** The title list cut to one scope, kept as long as the list is: `match`
    prepares a list once per array, so a new array per key would cost that
    preparation on every keystroke. */
const cuts = new WeakMap<Hit[], Map<string, Hit[]>>();

function scoped(all: Hit[], scope: Scope): Hit[] {
  // The history changes as the reader reads; it is fifty pages, cheap to cut.
  if (scope.history) {
    const at = new Map(recents().map((entry, i) => [entry.path, i]));
    return all.filter((hit) => at.has(hit.path)).sort((a, b) => at.get(a.path)! - at.get(b.path)!);
  }
  let byScope = cuts.get(all);
  if (!byScope) cuts.set(all, (byScope = new Map()));
  let cut = byScope.get(scope.label);
  if (!cut) {
    const test = scopeTest(scope);
    byScope.set(scope.label, (cut = all.filter((hit) => test(hit.path))));
  }
  return cut;
}

/** Whether a query is a page's whole title plus more words, before or after. */
function names(query: string, title: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const name = title.toLowerCase().split(/\s+/).filter(Boolean);
  if (name.length === 0 || words.length <= name.length) return false;
  const same = (from: number) => name.every((word, i) => words[from + i] === word);
  return same(0) || same(words.length - name.length);
}

/** A result set, with the query it answers. */
export interface Found {
  query: string;
  hits: Hit[];
}

const NONE: Found = { query: "", hits: [] };

/**
 * The search behind every field in the app.
 *
 * Two paths, as the spec says. The titles come back from Rust once and are
 * picked from in memory, so the list answers every keystroke. The body text is
 * searched in SQLite with FTS5, a moment behind, and its hits are added under
 * the title hits. See spec: Local — SQLite FTS5 Index.
 *
 * The hits come back with the query they answer, so a caller never reads a
 * count against text the reader has already typed past.
 */
export function useSearch(query: string): Found {
  const [found, setFound] = useState<Found>(NONE);

  // `live` drops the answer to a query the reader has already typed past.
  useEffect(() => {
    // `vex:noise` searches the VEX functions for "noise". See lib/scope.
    const { scope, rest } = parseScope(query.trim());
    const wanted = rest.trim();
    const answer = query.trim();
    let live = true;
    // A shorthand alone lists what it holds: `h:` is the pages read, newest first.
    if (!wanted) {
      if (!scope) setFound(NONE);
      else titles().then((all) => live && setFound({ query: answer, hits: scoped(all, scope).slice(0, 20) }));
      return () => {
        live = false;
      };
    }
    // Words in double quotes must be on the page as typed (`"$FF"`). Only the
    // body search can say that, so the title pick sits out.
    const exact = wanted.includes('"');
    const pick = (all: Hit[]) => (exact ? [] : match(scope ? scoped(all, scope) : all, wanted));

    if (!exact)
      titles().then((all) => {
        if (live) setFound({ query: answer, hits: pick(all) });
      });

    if (wanted.length < MIN_BODY_QUERY) return () => { live = false; };

    const timer = window.setTimeout(async () => {
      // A scope throws most of the ranking away, so it asks for more of it.
      const [all, texts] = await Promise.all([titles(), bodies(wanted, scope ? 40 : undefined)]);
      const test = scopeTest(scope);
      const found = scope ? texts.filter((hit) => test(hit.path)).slice(0, 6) : texts;
      if (!live) return;
      // "box size" names the Box page and a thing on it. The body search
      // ranks that page first (see `named` in search.rs); the title list,
      // which reads "box size" as one name, must not bury it under getbbox_size.
      // Not while the words are the start of a title: "copy to points".
      const typing = wanted.toLowerCase();
      const lead = exact || all.some((hit) => hit.title.toLowerCase().startsWith(typing))
        ? undefined
        : found.find((hit) => names(wanted, hit.title));
      const picked = pick(all).filter((hit) => hit.path !== lead?.path);
      const seen = new Set(picked.map((hit) => hit.path));
      setFound({
        query: answer,
        hits: [...(lead ? [lead] : []), ...picked, ...found.filter((hit) => !seen.has(hit.path) && hit !== lead)],
      });
    }, BODY_SEARCH_DELAY);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return found;
}
