import { recordPageView, recordViewBeacon } from "./telemetry";
import type { TelemetryEnv } from "./telemetry/types";
import { cacheKey, fromCache, keep } from "./lib/edge-cache";
import { storedAnswer, type Bucket } from "./lib/stored-answer";
import { isProbe } from "./lib/is-probe";
import { NOTICE_PATH } from "./lib/notice";
import { goneStatus, takedownAnswer } from "./lib/takedown";

/**
 * The OpenNext entry, loaded by the request that needs it and never at module
 * scope.
 *
 * A static import evaluates on every cold isolate, and that module pulls in
 * the Next middleware bundle: 870 KB of JavaScript, measured on this build. It
 * is what makes a cold prefetch cost 337 CPU-ms when the answer itself is one
 * R2 read. The Next *server* was already lazy inside that module; this makes
 * the rest of it lazy too, so an isolate that only ever answers from R2 never
 * evaluates any of Next.
 *
 * No Durable Object class is re-exported. The queue is deleted (see
 * wrangler.jsonc) and nothing binds the tag cache or the cache purge, so every
 * export was inert — and a static re-export is exactly what would force this
 * module to load. Restore them beside the durable_objects bindings that need
 * them, as static re-exports from `.open-next/worker.js`.
 */
type NextHandler = { fetch(request: Request, env: unknown, ctx: unknown): Promise<Response> };
let loading: Promise<NextHandler> | undefined;
const nextHandler = (): Promise<NextHandler> =>
  (loading ??= import("./.open-next/worker.js").then((m) => m.default as NextHandler));

/** The site's old host. Each address there answers one 301 to the same
    path and query on `URL`, the new origin. */
const OLD_HOST = "houdinimd.com";

interface Env extends TelemetryEnv {
  URL: string;
  NEXT_INC_CACHE_R2_BUCKET: Bucket;
  [key: string]: unknown;
}

const STATIC_ARCHIVE_MIME: Record<string, string> = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  woff2: "font/woff2",
  map: "application/json",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

const worker = {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void; passThroughOnException(): void }) {
    const url = new URL(request.url);
    if (url.hostname === OLD_HOST) return Response.redirect(`${env.URL}${url.pathname}${url.search}`, 301);

    const beacon = recordViewBeacon(request, url, env, ctx);
    if (beacon) return beacon;

    const gone = takedownAnswer(request, url);
    if (gone) {
      recordPageView(request, url, gone, env, ctx);
      return request.method === "HEAD" ? new Response(null, gone) : gone;
    }

    if (url.pathname.startsWith("/_next/static/") && request.method === "GET") {
      const archived = await env.NEXT_INC_CACHE_R2_BUCKET.get(`static-archive${url.pathname}`).catch(() => null);
      if (archived) {
        const ext = url.pathname.split(".").pop() ?? "";
        return new Response(archived.body, {
          headers: {
            "content-type": STATIC_ARCHIVE_MIME[ext] ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      }
    }

    // The notice template holds placeholders, not a page. See lib/notice.ts.
    if (isProbe(url.pathname) || url.pathname === NOTICE_PATH) return new Response("Not found", { status: 404 });

    // The edge cache sits here, in front of the Next server, because the cost
    // it saves is Next's own bootstrap. See lib/edge-cache.ts. It holds the
    // answer as Next gave it; the takedown status goes on at the way out.
    const key = cacheKey(request, url);
    if (key) {
      const hit = await fromCache(key);
      if (hit) {
        const answer = goneStatus(url, hit);
        recordPageView(request, url, answer, env, ctx);
        return answer;
      }
    }

    // A prerendered page, its prefetches and its RSC payload are a lookup in
    // an object Next would read anyway, so they are answered here and Next is
    // never started. See lib/stored-answer.ts.
    const stored = await storedAnswer(request, url, env.NEXT_INC_CACHE_R2_BUCKET);
    if (stored) {
      if (key) keep(key, stored, ctx);
      const answer = goneStatus(url, stored);
      recordPageView(request, url, answer, env, ctx);
      // A HEAD is answered like the GET beside it and loses its body here, so
      // every branch above can be written once.
      return request.method === "HEAD" ? new Response(null, answer) : answer;
    }

    let response = await (await nextHandler()).fetch(request, env, ctx);
    const contentType = response.headers.get("content-type") ?? "";
    if (
      (contentType.includes("text/html") || contentType.includes("text/x-component")) &&
      response.headers.get("cache-control")?.includes("stale-while-revalidate")
    ) {
      response = new Response(response.body, response);
      response.headers.set("cache-control", "public, max-age=0, must-revalidate");
    }
    if (key) keep(key, response, ctx);
    const answer = goneStatus(url, response);
    recordPageView(request, url, answer, env, ctx);
    return answer;
  },
};

export default worker;
