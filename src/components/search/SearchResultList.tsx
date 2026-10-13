/**
 * The result list, shared by every search field in the app.
 *
 * Everything that decides WHAT a result looks like lives here, so no caller can
 * grow a plainer list of the same results. The site learned that the hard way:
 * the row was shared but the model around it was not, and the two fields drifted.
 *
 * One thing the site had to do is gone. It fetched each excerpt over the
 * network, because its index stored WHICH section matched and not what it said.
 * Here the index is on disk, so Rust returns the words with the hit and a row is
 * complete the moment it renders.
 */
import { useEffect, useMemo, useRef } from "react";
import { SearchResultRow } from "@/components/search/SearchResultRow";
import { category, type Hit, type Section } from "@/lib/search";

/**
 * The look of the predictive list — the single source of truth for it. Only the
 * surface is here; where the list sits and how high it stacks stays with each
 * caller, because callers put it in different places.
 *
 * No horizontal padding: a list with straight sides of its own wants a
 * highlighted row to run full width. Only a dropdown inside a card needs a side
 * gutter, and it adds one below.
 *
 * The height is bounded by the viewport as well as by a row count: on a short
 * window a fixed `max-h` runs off the bottom, where it cannot be scrolled to.
 */
export const SEARCH_LIST_CLASS = "py-xs overflow-y-auto overscroll-contain max-h-[min(20rem,60dvh)]";

/** The list as a panel of its own — what a field drops below itself. */
export const SEARCH_DROPDOWN_CLASS = `mt-sm rounded-xl bg-popover border border-hairline shadow-pane px-xs ${SEARCH_LIST_CLASS}`;

/** One selectable line: a page, one of its matching sections, or its prose. */
export interface Row {
  hit: Hit;
  section?: Section;
  /** The prose row a page gets when no section of it matched. */
  text?: boolean;
}

/**
 * Flatten pages and their sub-hits into arrow-key order.
 *
 * A page with no matching section still gets one row for its own prose, so
 * every result can show WHY it matched rather than only its title.
 */
export function toRows(hits: Hit[], withSubHits = true): Row[] {
  if (!withSubHits) return hits.map((hit) => ({ hit }));
  return hits.flatMap((hit) => [
    { hit },
    ...(hit.headings?.length
      ? hit.headings.map((section) => ({ hit, section }))
      : [{ hit, text: true }]),
  ]);
}

/** Where a row goes: the page, or the page at one of its headings. */
export function rowPath(row: Row): string {
  return row.section?.slug ? `${row.hit.path}#${row.section.slug}` : row.hit.path;
}

/** Identifies a row within one result set. */
const rowKey = (row: Row) => `${row.hit.path}#${row.section?.slug ?? ""}`;

export function SearchResultList({
  hits,
  query,
  selected,
  onSelect,
  onActivate,
  withSubHits = true,
  header,
  footer,
  className,
  rowRounded = true,
}: {
  hits: Hit[];
  /** What the reader typed, bolded inside each excerpt. */
  query: string;
  selected: number;
  onSelect: (index: number) => void;
  /** The click comes along for the keys held with it. */
  onActivate: (row: Row, index: number, event?: React.MouseEvent) => void;
  /** Off for lists of pages the reader already chose, where sub-hits are noise. */
  withSubHits?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** Off for a list with no side gutter, where a rounded row shows corner slivers. */
  rowRounded?: boolean;
}) {
  const rows = useMemo(() => toRows(hits, withSubHits), [hits, withSubHits]);
  const listRef = useRef<HTMLUListElement>(null);

  // Keeping the selected row in view belongs here and not in each caller: the
  // site's landing field had no such effect and its arrow keys walked off
  // screen. Rows are found by index rather than by child position, so an
  // optional header or footer `li` cannot shift the lookup.
  useEffect(() => {
    const list = listRef.current;
    const row =
      list?.querySelector(`[data-row="${selected}"]`) ??
      // Past the last row is the footer, when a caller supplies one.
      (selected >= rows.length ? list?.lastElementChild : null);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected, rows.length]);

  return (
    <ul ref={listRef} className={className}>
      {header}
      {rows.map((row, i) => (
        <li key={`${rowKey(row)}${row.section || row.text ? ":sub" : ""}`} data-row={i}>
          <SearchResultRow
            title={
              row.section
                ? row.section.heading || row.hit.title
                : // A page that says nothing about itself shows its path, never
                  // its own title again: two identical lines say less than one,
                  // and the path is what tells two pages of a name apart.
                  row.text
                  ? row.hit.summary || row.hit.path
                  : row.hit.title
            }
            category={category(row.hit)}
            icon={row.hit.icon}
            sub={Boolean(row.section || row.text)}
            // A section with no heading is the text above the first one, which
            // is prose and not a place the reader can be sent to.
            subKind={row.section?.heading ? "heading" : "text"}
            excerpt={row.section?.excerpt}
            query={query}
            active={i === selected}
            rounded={rowRounded}
            onClick={(event) => onActivate(row, i, event)}
            onMouseMove={() => onSelect(i)}
          />
        </li>
      ))}
      {footer}
    </ul>
  );
}
