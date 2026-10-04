/**
 * Answer a prerendered request from R2, without starting Next.
 *
 * Next serves a prerendered page by reading one R2 object and returning bytes
 * it already holds. The cost is the bootstrap: on a cold isolate Next must be
 * evaluated first, and Cloudflare bills that to the request that meets it.
 * Measured on the live Worker with `wrangler tail`, 17 September 2026: a page
 * cost 326 CPU-ms on average, against 1-3 for an answer written in `worker.ts`.
 *
 * Answered here: a page, its RSC payload and its segment prefetches, from the
 * ISR entry; `/robots.txt` and `/sitemap.xml`; `/download`; and every doc
 * address, which gets the one notice with its title filled in (lib/notice.ts).
 *
 * WHY THE EDGE CACHE DOES NOT ALREADY COVER THIS.
 *
 * `caches.default` is per colo. The traffic is thin and spread over the world,
 * so a page is usually asked for once in any one colo: 7% of prefetches hit
 * it. R2 is a single store behind every colo.
 *
 * WHAT IT REFUSES.
 *
 * Everything it is not certain about, by returning null — the caller then
 * hands the request to Next.
 */
import buildId from "./build-id.json";
import { assetUrl, MANIFEST, platformForPath, type Platform } from "./download";
import { REPO_URL } from "./brand";
import { fillHtml, fillPayload, NOTICE_PATH, noticeValues } from "./notice";

/** `segmentData` stores this one as null when it equals `rsc`. See lib/cache/compressed-r2-cache.ts. */
const FULL_SEGMENT_KEY = "/_full";

/** Just the part of an R2 binding this module uses. */
export interface Bucket {
  get(key: string): Promise<{ body: ReadableStream } | null>;
}

interface Entry {
  html?: string;
  rsc?: string;
  segmentData?: Record<string, string | null>;
  /** A route handler's whole answer, when the route is prerendered. */
  body?: string;
  meta?: { status?: number; headers?: Record<string, string> };
}

/** What Next says an RSC answer varies on. It sends this on the page too. */
const VARY = "rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch";

/** The value `worker.ts` rewrites a Next page answer to. Both paths agree. */
const PAGE_CACHE_CONTROL = "public, max-age=0, must-revalidate";

const PREFETCH_HEADERS: Record<string, string> = {
  "content-type": "text/x-component",
  vary: VARY,
  "x-nextjs-cache": "HIT",
  "cache-control": PAGE_CACHE_CONTROL,
};

const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  vary: VARY,
  "x-nextjs-cache": "HIT",
  "cache-control": PAGE_CACHE_CONTROL,
};

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Paths whose answer is one prerendered entry per build, and the name Next
 * stores that entry under. The root is `/index`, not `/`.
 */
const FIXED_PAGES: ReadonlyMap<string, string> = new Map([
  ["/", "/index"],
  ["/privacy", "/privacy"],
]);

/**
 * Route handlers Next prerenders whole: the entry carries the body and the
 * headers the route itself set, so nothing here decides what they say.
 */
const STORED_ROUTES: ReadonlySet<string> = new Set(["/robots.txt", "/sitemap.xml"]);

type Ask =
  | { kind: "route"; path: string }
  | { kind: "page"; path: string }
  | { kind: "rsc"; path: string }
  | { kind: "prefetch"; path: string; segment: string }
  | { kind: "download"; platform: Platform }
  | { kind: "moved"; to: string }
  | { kind: "notallowed" };

/** What the root answers to. Next reports the same pair in its `allow`. */
const ROOT_METHODS = new Set(["GET", "HEAD"]);

function read(request: Request, url: URL): Ask | null {
  // Bots post to the root. Nothing there takes a POST, and Next booted to say
  // so: six of these cost 373 to 789 CPU-ms in one 45-minute tail, 23% of the
  // window, for an answer that is a status and one header.
  if (url.pathname === "/" && !ROOT_METHODS.has(request.method) && request.method !== "OPTIONS") {
    return { kind: "notallowed" };
  }

  // HEAD asks the same question as GET and wants only the headers. It was sent
  // to Next for the whole answer and then had the body thrown away: one HEAD
  // for a `.md` twin cost 1,145 CPU-ms against 0 to 5 for the GET beside it.
  // worker.ts drops the body once the answer is made.
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  // The installer address never varies on a query, and a download link is
  // exactly the kind that arrives wearing one — a campaign tag, a referrer
  // mark. Read it in front of the gate below or those asks pay a bootstrap.
  const platform = platformForPath(url.pathname);
  if (platform) return { kind: "download", platform };

  // A prerendered answer never varies on a query string, and the keys read
  // below carry none. The one exception is `_rsc`, the cache buster Next puts
  // on every RSC and prefetch request: the value never changes the answer.
  // Anything else arriving with a query is Next's business.
  if (url.search && [...url.searchParams.keys()].join() !== "_rsc") return null;

  if (STORED_ROUTES.has(url.pathname)) return { kind: "route", path: url.pathname };

  const segment = request.headers.get("next-router-segment-prefetch");
  const rsc = request.headers.get("rsc");

  const fixed = FIXED_PAGES.get(url.pathname);
  if (fixed) {
    if (segment) return { kind: "prefetch", path: fixed, segment };
    if (rsc) return { kind: "rsc", path: fixed };
    return { kind: "page", path: fixed };
  }

  if (url.pathname !== "/docs" && !url.pathname.startsWith("/docs/")) return null;
  // A trailing slash or a `.html` is a redirect, and middleware writes it.
  if (url.pathname.endsWith("/")) return { kind: "moved", to: url.pathname.replace(/\/+$/, "") + url.search };
  if (url.pathname.endsWith(".html")) return null;
  if (segment) return { kind: "prefetch", path: url.pathname, segment };
  if (rsc) return { kind: "rsc", path: url.pathname };
  return { kind: "page", path: url.pathname };
}

/**
 * The stored ISR entry for a path, or null. Never throws: a malformed or
 * missing entry is a miss, and a miss is the behaviour this replaces.
 */
async function readEntry(path: string, cache: Bucket): Promise<Entry | null> {
  try {
    const object = await cache.get(
      `incremental-cache/${buildId.buildId}/${await sha256Hex(path)}.cache`,
    );
    if (!object) return null;

    const json = await new Response(
      object.body.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    return JSON.parse(json) as Entry;
  } catch {
    return null;
  }
}

/**
 * The `x-nextjs-*` headers the build wrote beside the entry.
 *
 * `x-nextjs-stale-time` is how long the client router may keep a prefetched
 * answer. A prerendered doc page carries 4294967294, which is Next's way of
 * saying it never goes stale. Drop the header and the router treats every
 * prefetch as stale the moment it lands, so a click refetches the whole page
 * it was just given: measured on the live site as one full RSC request per
 * navigation, no matter how long the cursor rested on the link.
 *
 * The tag list is the exception. It drives revalidation inside Next and means
 * nothing to a reader.
 */
function storedMeta(entry: Entry): Record<string, string> {
  const { "x-next-cache-tags": _tags, ...rest } = entry.meta?.headers ?? {};
  return rest;
}

async function entryFor(path: string, cache: Bucket): Promise<Entry | null> {
  const entry = await readEntry(path, cache);
  if (!entry) return null;

  // A stored 404 or 500 is Next's to give: that status carries headers and
  // a no-store rule this file does not reproduce.
  if (entry.meta?.status !== undefined && entry.meta.status !== 200) return null;
  return entry;
}

/**
 * `/download` — the newest Windows installer, resolved without starting Next.
 *
 * GitHub has no "latest asset matching a pattern" URL and the bundler writes
 * the version into the file name, so the address has to be resolved on every
 * ask. The version comes from `latest.json`, the manifest the app's updater
 * reads (`MANIFEST`). With GitHub's API, every ask fell back to the release
 * page. This ran inside Next: two asks
 * in one hour of live log cost 689 and 393 CPU-ms, against 2 ms warm, because
 * each landed on a colo with a cold isolate and paid the whole bootstrap to
 * write one redirect.
 *
 * `cacheTtl` holds the manifest at the edge, so most asks cost no subrequest
 * at all. Five minutes is the delay between publishing a
 * release and the link pointing at it.
 */
/** Where the reader lands if GitHub cannot be asked. Never a dead link. */
const RELEASES_PAGE = `${REPO_URL}/releases/latest`;

async function download(platform: Platform): Promise<Response> {
  let to = RELEASES_PAGE;
  try {
    const response = await fetch(MANIFEST, {
      cf: { cacheTtl: 300, cacheEverything: true },
    } as RequestInit);
    if (response.ok) {
      const { version } = (await response.json()) as { version?: string };
      if (version) {
        to = assetUrl(version, platform);
      }
    }
  } catch {
    // RELEASES_PAGE already holds the answer.
  }
  return new Response(null, {
    status: 302,
    headers: { location: to, "cache-control": "public, s-maxage=300" },
  });
}

/** The stored answer for this request, or null to let Next answer. */
export async function storedAnswer(
  request: Request,
  url: URL,
  cache: Bucket,
): Promise<Response | null> {
  const ask = read(request, url);
  if (!ask) return null;

  if (ask.kind === "moved") {
    return new Response(null, {
      status: 308,
      headers: { location: ask.to, "cache-control": "public, max-age=3600, s-maxage=86400" },
    });
  }
  if (ask.kind === "download") return download(ask.platform);
  if (ask.kind === "notallowed") {
    return new Response(null, { status: 405, headers: { allow: "GET,HEAD", vary: VARY } });
  }
  const doc = ask.path === "/docs" || ask.path.startsWith("/docs/");
  const [entry, notice] = await Promise.all([
    entryFor(doc ? NOTICE_PATH : ask.path, cache),
    doc ? noticeValues(ask.path, cache) : null,
  ]);
  if (!entry) return null;
  const payload = (text: string) => (notice ? fillPayload(text, notice) : text);

  if (ask.kind === "route") {
    if (typeof entry.body !== "string") return null;
    return new Response(entry.body, {
      headers: { ...storedMeta(entry), vary: VARY, "x-nextjs-cache": "HIT" },
    });
  }

  if (ask.kind === "prefetch") {
    const stored = entry.segmentData?.[ask.segment];
    if (stored === undefined) return null;
    // Null means the de-duplication dropped it because it equalled `rsc`.
    const segment = stored === null && ask.segment === FULL_SEGMENT_KEY ? entry.rsc : stored;
    if (typeof segment !== "string") return null;
    return new Response(payload(segment), { headers: { ...storedMeta(entry), ...PREFETCH_HEADERS } });
  }

  if (ask.kind === "rsc") {
    return typeof entry.rsc === "string"
      ? new Response(payload(entry.rsc), { headers: { ...storedMeta(entry), ...PREFETCH_HEADERS } })
      : null;
  }

  if (typeof entry.html !== "string") return null;
  const page = notice ? fillHtml(entry.html, notice) : entry.html;
  return new Response(page, { headers: { ...storedMeta(entry), ...PAGE_HEADERS } });
}
