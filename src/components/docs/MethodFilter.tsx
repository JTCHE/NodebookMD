/**
 * The bar at the top of a class's Methods: a filter over every method on the
 * page, its own and the inherited ones, and a switch that opens or closes
 * them all. The rows come from the parser (`rehype-hom`), so this works on
 * the page's DOM: it hides what does not match and puts nothing new in it.
 * It stays at the top while the reader scrolls through the methods.
 */
import { useRef, useState } from "react";
import { Icons } from "@/lib/ui/icons";
import { BAR_BUTTON } from "@/lib/ui/button";
import { Hint } from "@/components/ui/Hint";

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

  const toggleLabel = expanded ? "Collapse all" : "Expand all";
  const ToggleIcon = expanded ? Icons.collapseAll : Icons.expandAll;
  return (
    <div ref={bar} className="not-prose sticky top-(--page-bar-h) z-10 -mx-[calc(1rem+1px)] mb-md bg-background px-[calc(1rem+1px)] py-xs">
      {/* The negative margin is the distance from the field's edge to the
          glyphs at each end, so the search glyph sits on the text's axis. */}
      <div
        role="search"
        className="-mx-2.5 flex items-center rounded-[10px] border border-transparent bg-muted/40 p-1 transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-muted/70 focus-within:border-input focus-within:bg-muted/70"
      >
        <span className="grid size-7 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
          <Icons.search className="size-4" />
        </span>
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
          className="h-7 min-w-0 flex-1 bg-transparent px-xs text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {count && (
          <span aria-live="polite" className="shrink-0 px-xs text-xs text-muted-foreground tabular-nums">
            {count.shown} of {count.total}
          </span>
        )}
        <span className="mx-2xs h-4 w-px shrink-0 bg-hairline" aria-hidden="true" />
        <Hint label={toggleLabel}>
          <button type="button" aria-label={toggleLabel} onClick={toggleAll} className={BAR_BUTTON}>
            <ToggleIcon className="size-4" />
          </button>
        </Hint>
      </div>
    </div>
  );
}
