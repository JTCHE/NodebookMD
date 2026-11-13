/**
 * The bar at the top of a class's Methods: a filter over every method on the
 * page, its own and the inherited ones, and a switch that opens or closes
 * them all. The rows come from the parser (`rehype-hom`), so this works on
 * the page's DOM: it hides what does not match and puts nothing new in it.
 */
import { useRef, useState } from "react";
import { Icons } from "@/lib/ui/icons";
import { ACTION, QUIET } from "@/lib/ui/button";
import { cn } from "@/lib/utils";

/** `num_components`, `numComponents` and `NumComponents` match each other. */
const fold = (value: string) => value.toLowerCase().replace(/[_\s]/g, "");

export function MethodFilter() {
  const bar = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const page = () => bar.current?.closest("article") ?? document;

  function filter(next: string) {
    setQuery(next);
    const wanted = fold(next);
    const rows = [...page().querySelectorAll<HTMLElement>(".hom-method[data-name]")];
    let shown = 0;
    for (const row of rows) {
      // The name first; the caption too, so "label" finds what returns one.
      const caption = row.querySelector(".hom-method-caption")?.textContent ?? "";
      const match = !wanted || fold(row.dataset.name ?? "").includes(wanted) || fold(caption).includes(wanted);
      row.hidden = !match;
      if (match) shown += 1;
    }
    // A group with no row left goes, and its heading with it.
    for (const group of page().querySelectorAll<HTMLElement>(".section-group")) {
      if (!group.querySelector(".hom-method[data-name]")) continue;
      const empty = !group.querySelector(".hom-method[data-name]:not([hidden])");
      group.hidden = empty;
      const heading = group.previousElementSibling as HTMLElement | null;
      if (heading && /^H[2-6]$/.test(heading.tagName)) heading.hidden = empty;
    }
    setCount(wanted ? { shown, total: rows.length } : null);
  }

  function toggleAll() {
    const next = !expanded;
    for (const row of page().querySelectorAll<HTMLDetailsElement>("details.hom-method")) row.open = next;
    setExpanded(next);
  }

  return (
    <div ref={bar} className="not-prose mb-md flex items-center gap-sm">
      <label className={cn(QUIET, "flex h-8 min-w-0 flex-1 items-center rounded-lg hover:bg-muted/50")}>
        <Icons.search className="ml-sm size-3.5 shrink-0" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => filter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              filter("");
            }
          }}
          placeholder="Filter methods"
          aria-label="Filter methods"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent px-xs text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {count && (
          <span aria-live="polite" className="shrink-0 px-sm text-xs tabular-nums">
            {count.shown} of {count.total}
          </span>
        )}
      </label>
      <button type="button" onClick={toggleAll} className={cn(ACTION, QUIET)}>
        {expanded ? "Collapse all" : "Expand all"}
      </button>
    </div>
  );
}
