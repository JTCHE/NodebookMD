import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { titleOf, warmTitleIndex } from "@/lib/search";
import { warm } from "@/lib/pages";
import { toTitleCase } from "@/lib/markdown/page-title";

/**
 * The path of a page is its place in the docs, so the trail is read from it.
 *
 * An ancestor segment names a real index page in the install — `nodes/sop`
 * is titled "Geometry nodes", not "Sop" — so the crumb reads that page's own
 * title rather than guessing one from the URL.
 *
 * The title comes from the title list, which the search field already holds in
 * memory for the whole session. Reading the ancestor PAGE instead would parse
 * a zip in Rust on every navigation, and would push real pages out of the page
 * cache to hold index pages nobody opened. The guessed text holds the crumb's
 * place until that list lands, once, on the first navigation of a session.
 */
export function Breadcrumbs({ path, version, title }: { path: string; version?: string; title: string }) {
  const segments = path.split("/").filter(Boolean).slice(0, -1);
  const [, forceRender] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void warmTitleIndex().then(() => {
      if (!cancelled) forceRender((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentHref = `/${path}`;
  const crumbs = [
    { label: version ? `Houdini ${version}` : "Houdini", href: "/" },
    ...segments
      .map((segment, index) => {
        const ancestorPath = `${segments.slice(0, index + 1).join("/")}/index`;
        const ancestorTitle = titleOf(ancestorPath)?.trim();
        return {
          // The guess is Title Cased here rather than by CSS `capitalize`,
          // because CSS cannot know that `sop` is an acronym.
          label: ancestorTitle || toTitleCase(segment.replace(/-/g, " ")),
          href: `/${ancestorPath}`,
        };
      })
      // Already on this exact index page: its own title is the last crumb,
      // and a crumb for it here would only repeat that title right next to it.
      .filter((crumb) => crumb.href !== currentHref),
    { label: title, href: null },
  ];

  return (
    <nav className="flex flex-wrap items-center text-xs text-muted-foreground print:hidden">
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="inline-flex items-center">
            {crumb.href ? (
              <Link
                to={crumb.href}
                className="rounded-sm underline-offset-2 transition-colors hover:text-neutral-700 hover:underline focus-ring"
                // A crumb is an index page, often a long one: it is read and
                // parsed while the pointer is on its way to the press.
                onPointerEnter={() => crumb.href !== "/" && warm(crumb.href.slice(1))}
              >
                {crumb.label}
              </Link>
            ) : (
              <span data-current-crumb="" className="text-foreground cursor-default">{crumb.label}</span>
            )}
            {!isLast && <ChevronRight className="mx-1 my-1 size-3.5 shrink-0 text-muted-foreground/40" aria-hidden="true" />}
          </span>
        );
      })}
    </nav>
  );
}
