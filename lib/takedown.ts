/**
 * SideFX asked for its documentation to come off this site. Every address that
 * served it now answers 410, and none of them carries a SideFX sentence.
 *
 * A doc page keeps its prerendered title and breadcrumbs (app/docs), and the
 * Worker gives that answer its 410 here. Every raw shape — `.md`, the API, the
 * icons — is answered here in plain text, before Next starts.
 */
import { wantsMarkdown } from "./wants-markdown";

const SIDEFX_DOCS_ROOT = "https://www.sidefx.com/docs";

/** The notice, in the words both the page and the plain answer use. */
export const GONE = "This page is no longer available here.";
export const REASON = "At the request of SideFX, its documentation is no longer hosted on this site.";

/** The page's own address on sidefx.com. */
export const sidefxUrl = (slug: string) => `${SIDEFX_DOCS_ROOT}/${slug}`;

/** A doc slug from a `/docs/` path, with the `.md` and `.html` a link may carry. */
const slugOf = (pathname: string) =>
  pathname
    .slice("/docs/".length)
    .replace(/\.md$/, "")
    .replace(/\.html$/, "")
    .replace(/\/+$/, "");

const isDoc = (pathname: string) => pathname === "/docs" || pathname.startsWith("/docs/");

function plain(source: string): Response {
  const body = `${GONE}\n${REASON}\nRead it on sidefx.com: ${source}\n`;
  return new Response(body, {
    status: 410,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
      "x-robots-tag": "noindex",
    },
  });
}

/** The plain 410 for a raw shape, or null for a page Next renders. */
export function takedownAnswer(request: Request, url: URL): Response | null {
  const path = url.pathname;
  if (path.startsWith("/icons/") || path.startsWith("/api/") || path === "/docs.md") {
    return plain(`${SIDEFX_DOCS_ROOT}/`);
  }
  if (!isDoc(path)) return null;

  // The rendered page only for a reader: an agent, a `.md` twin and a
  // regenerate ask get the words and the link, not the page around them. A
  // router fetch (`rsc`) is the reader's own page moving.
  if (
    path.endsWith(".md") ||
    url.searchParams.has("regenerate") ||
    (!request.headers.has("rsc") && wantsMarkdown(request.headers.get("user-agent"), request.headers))
  ) {
    return plain(sidefxUrl(slugOf(path)));
  }
  return null;
}

/** A doc page answer as it leaves the Worker: 410, and never indexed. */
export function goneStatus(url: URL, response: Response): Response {
  if (!isDoc(url.pathname) || response.status !== 200) return response;
  if (!response.headers.get("content-type")?.includes("text/html")) return response;
  const gone = new Response(response.body, { status: 410, headers: response.headers });
  gone.headers.set("x-robots-tag", "noindex");
  return gone;
}
