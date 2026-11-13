/**
 * The bar at the top of a class's methods: a filter over every method on the
 * page, its own and the inherited ones, and a switch that opens or closes
 * them all. It sits in the box that holds all the method sections
 * (`.hom-methods`), so it covers each of them and no filter can hide it. The rows come from the parser (`rehype-hom`), so this works on
 * the page's DOM: it hides what does not match and puts nothing new in it.
 * It stays at the top while the reader scrolls through the methods.
 */
import { useRef, useState } from "react";
import { Icons } from "@/lib/ui/icons";
import { BAR_BUTTON } from "@/lib/ui/button";
import { Hint } from "@/components/ui/Hint";
import { revealSections } from "@/lib/ui/sections";

/** `num_components`, `numComponents` and `NumComponents` match each other. */
const fold = (value: string) => value.toLowerCase().replace(/[_\s]/g, "");

export function MethodFilter() {
  const bar = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<{ shown: number; total: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  // The row the filter opened because it was the only match. The filter
  // closes it again when the query changes; a row the reader opened stays.
  const opened = useRef<HTMLDetailsElement | null>(null);

  const page = () => bar.current?.closest(".hom-methods") ?? document;

  function filter(next: string) {
    setQuery(next);
    const wanted = fold(next);
    const rows = [...page().querySelectorAll<HTMLElement>(".hom-method[data-name]")];
    let shown = 0;
    let last: HTMLElement | null = null;
    for (const row of rows) {
      // The name first; the caption too, so "label" finds what returns one.
      const caption = row.querySelector(".hom-method-caption")?.textContent ?? "";
      const match = !wanted || fold(row.dataset.name ?? "").includes(wanted) || fold(caption).includes(wanted);
      row.hidden = !match;
      if (match) {
        shown += 1;
        last = row;
      }
      // A match in a section the reader closed is still a match: show it.
      if (match && wanted) revealSections(row);
    }
    // A group with no row left goes, and its heading with it. A mark, not
    // `hidden`: `hidden` is the reader's own collapse, and clearing the
    // filter must not open what they closed.
    for (const group of page().querySelectorAll<HTMLElement>(".section-group")) {
      if (!group.querySelector(".hom-method[data-name]")) continue;
      const empty = !group.querySelector(".hom-method[data-name]:not([hidden])");
      group.toggleAttribute("data-no-match", empty);
      const heading = group.previousElementSibling as HTMLElement | null;
      if (heading && /^H[2-6]$/.test(heading.tagName)) heading.toggleAttribute("data-no-match", empty);
    }
    // One match is the method the reader looked for: open it.
    const only = wanted && shown === 1 && last instanceof HTMLDetailsElement ? last : null;
    if (opened.current && opened.current !== only) opened.current.open = false;
    opened.current = null;
    if (only && !only.open) {
      only.open = true;
      opened.current = only;
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
    <div ref={bar} className="not-prose sticky top-(--page-bar-h) z-10 -mx-[calc(1rem+1px)] mb-md flex items-center gap-xs bg-background py-xs">
      {/* Two axes, the same as the method rows: the field's edge on the
          rows' edge, and the search glyph on the text (1px border + 1rem).
          The whole field is the label, so a press on its padding puts the
          cursor in the input. */}
      <label className="flex min-w-0 flex-1 cursor-text items-center rounded-[10px] border border-transparent bg-muted/40 py-1 pr-1 pl-4 transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-muted/70 focus-within:border-input focus-within:bg-muted/70">
        <Icons.search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          type="search"
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
          className="h-7 min-w-0 flex-1 bg-transparent pr-xs pl-sm text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {count && (
          <span aria-live="polite" className="shrink-0 px-xs text-xs text-muted-foreground tabular-nums">
            {count.shown} of {count.total}
          </span>
        )}
      </label>
      {/* Opening the rows is not part of the filter: it sits outside the
          field, its box on the rows' right edge. */}
      <Hint label={toggleLabel}>
        <button type="button" aria-label={toggleLabel} onClick={toggleAll} className={BAR_BUTTON}>
          <ToggleIcon className="size-4" />
        </button>
      </Hint>
    </div>
  );
}
