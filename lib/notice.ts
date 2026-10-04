/**
 * The doc notice, one page for every doc address.
 *
 * The build prerenders one notice (app/docs-notice) with placeholders where
 * the page's title, address and breadcrumbs go. The Worker fills them in from
 * the title map. One page per address cost a deploy ~22,000 R2 writes, because
 * every notice holds the build's chunk names and so changed with any build.
 *
 * The placeholders sit in three kinds of text, and each kind escapes the value
 * its own way: the HTML, the RSC payload, and the RSC payload inlined in the
 * HTML as a JavaScript string.
 */
import type { Bucket } from "./stored-answer";

export const TITLE = "__NOTICE_TITLE__";
export const SLUG = "__NOTICE_SLUG__";
export const CRUMBS = "__NOTICE_CRUMBS__";

/** The template's own address. Next stores its entry under this name. */
export const NOTICE_PATH = "/docs-notice";

/** Path → title for every doc address the site served. Written by scripts/cache-sync.ts. */
export const TITLES_KEY = "notice/titles.json";

export type Crumb = { label: string; href: string | null };

/**
 * The page's ancestors that are pages too, then the page itself. The tree
 * root is left out: its title names the SideFX product and version.
 */
export function crumbsFor(slug: string, titles: Map<string, string>): Crumb[] {
  const parts = slug.split("/");
  const chain: Crumb[] = [];
  for (let i = 2; i < parts.length; i++) {
    const path = parts.slice(0, i).join("/");
    const label = titles.get(path);
    if (label) chain.push({ label, href: `/docs/${path}` });
  }
  const own = titles.get(slug);
  return own ? [...chain, { label: own, href: null }] : chain;
}

const html = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** lucide's ChevronRight, as lucide-react draws it. */
const CHEVRON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right mx-1 size-3.5 shrink-0 text-muted-foreground/40" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';

function chainHtml(items: Crumb[]): string {
  return items
    .map((item, i) => {
      const last = i === items.length - 1;
      const label = item.href
        ? `<a href="${html(item.href)}" class="hover:text-foreground transition-colors">${html(item.label)}</a>`
        : `<span${last ? ' class="text-foreground cursor-default"' : ""}>${html(item.label)}</span>`;
      return `<span class="inline-flex items-center">${label}${last ? "" : CHEVRON}</span>`;
    })
    .join("");
}

/**
 * The whole path when it fits, else the last three crumbs, else the last two.
 * A container query cannot measure text, so each chain's width is estimated
 * from its characters: 7px each at text-sm (measured 6.3, rounded up), and
 * 22px for each chevron.
 */
export function crumbsHtml(chain: Crumb[]): string {
  if (!chain.length) return "";
  const width = (items: Crumb[]) =>
    7 * items.reduce((total, item) => total + item.label.length, 0) + 22 * Math.max(items.length - 1, 0);
  const three = chain.slice(-3);
  const style =
    ".bc-full, .bc-three { display: none; } .bc-two { display: inline; } " +
    `@container (min-width: ${width(three)}px) { .bc-two { display: none; } .bc-three { display: inline; } } ` +
    `@container (min-width: ${width(chain)}px) { .bc-three { display: none; } .bc-full { display: inline; } }`;
  return (
    `<span class="text-sm text-muted-foreground"><style>${style}</style>` +
    `<span class="bc-full">${chainHtml(chain)}</span>` +
    `<span class="bc-three">${chainHtml(three)}</span>` +
    `<span class="bc-two">${chainHtml(chain.slice(-2))}</span></span>`
  );
}

// ponytail: the whole map (~600 KB, ~4 ms to parse) is read once per isolate.
// Shard it by tree if notice CPU ever shows in a tail.
let titles: Promise<Map<string, string>> | undefined;

function titlesFrom(cache: Bucket): Promise<Map<string, string>> {
  return (titles ??= cache
    .get(TITLES_KEY)
    .then(async (object) => {
      if (!object) throw new Error("no title map");
      const json = await new Response(object.body.pipeThrough(new DecompressionStream("gzip"))).text();
      return new Map(Object.entries(JSON.parse(json) as Record<string, string>));
    })
    .catch(() => {
      // A miss gives the untitled notice, and the next request tries again.
      titles = undefined;
      return new Map<string, string>();
    }));
}

export type Values = Record<string, string>;

/** What the placeholders hold for a doc path. An address the site never served gets the untitled notice. */
export async function noticeValues(pathname: string, cache: Bucket): Promise<Values> {
  const slug = pathname.slice("/docs/".length);
  const map = slug ? await titlesFrom(cache) : new Map<string, string>();
  const title = map.get(slug);
  if (!title) return { [TITLE]: "Houdini documentation", [SLUG]: "", [CRUMBS]: "" };
  return { [TITLE]: title, [SLUG]: slug, [CRUMBS]: crumbsHtml(crumbsFor(slug, map)) };
}

const PLACEHOLDER = new RegExp(`("?)(${TITLE}|${SLUG}|${CRUMBS})`, "g");

/**
 * A value inside a string of the RSC payload. A string that starts with `$` is
 * a reference there, and React writes a literal one as `$$`.
 */
function fillRsc(text: string, values: Values, inline: (s: string) => string): string {
  return text.replace(PLACEHOLDER, (_, quote: string, key: string) => {
    const value = quote && values[key]!.startsWith("$") ? `$${values[key]}` : values[key]!;
    return quote + inline(JSON.stringify(value).slice(1, -1));
  });
}

/** Next's `htmlEscapeJsonString`, which it runs on the payload it inlines. */
const scriptSafe = (s: string) =>
  s.replace(/&/g, "\\u0026").replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The payload as an RSC answer or a segment prefetch carries it. */
export const fillPayload = (text: string, values: Values) => fillRsc(text, values, (s) => s);

const INLINE_PAYLOAD = /<script[^>]*>self\.__next_f\.push\([\s\S]*?<\/script>/g;

/** The page. Text and attributes take HTML escapes; the inlined payload is a JavaScript string. */
export function fillHtml(page: string, values: Values): string {
  let out = "";
  let at = 0;
  for (const m of page.matchAll(INLINE_PAYLOAD)) {
    out += fillText(page.slice(at, m.index), values);
    out += fillRsc(m[0], values, (s) => scriptSafe(JSON.stringify(s).slice(1, -1)));
    at = m.index + m[0].length;
  }
  return out + fillText(page.slice(at), values);
}

/** The crumbs are markup already, and go in as they are. */
const fillText = (text: string, values: Values) =>
  text.replace(PLACEHOLDER, (_, quote: string, key: string) => quote + (key === CRUMBS ? values[key]! : html(values[key]!)));
