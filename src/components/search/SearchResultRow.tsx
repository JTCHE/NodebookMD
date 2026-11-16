import { useMemo, useState } from "react";
import { iconUrl } from "@/lib/assets";
import { excerptText } from "@/lib/search";
import { cn } from "@/lib/utils";

/**
 * One result row (icon + title + category), and the nested rows under it.
 *
 * Ported unchanged in look from the site, so a reader who used the site sees
 * the same list here. Only where the pictures and the excerpts come from
 * differs: the site fetched both over the network, the app reads them out of
 * the Houdini install.
 */

/**
 * One icon set, drawn on the Solar Linear grid: 24 viewBox, round caps,
 * `currentColor`, and the one line weight of the chrome (see
 * `lib/ui/icon-stroke.ts`). Sharing the grid is what makes them look related — a
 * heavier stroke or a different viewBox reads as a different family even at the
 * same pixel size.
 */
function SolarIcon({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * Stand-in for pages with no icon of their own — VEX functions, HScript
 * commands and guide pages, a large part of the corpus. Without it those rows
 * lose the icon column and their titles sit out of line with the node results
 * around them.
 */
function DocumentIcon() {
  return (
    <SolarIcon className="size-5 text-muted-foreground/55">
      {/* Portrait, like a sheet of paper: 14 wide by 19 tall on the 24 grid. */}
      <path d="M14 2.5H10c-2.357 0-3.536 0-4.268.732C5 3.964 5 5.143 5 7.5v9c0 2.357 0 3.536.732 4.268.732.732 1.911.732 4.268.732h4c2.357 0 3.536 0 4.268-.732.732-.732.732-1.911.732-4.268V8L14 2.5Z" />
      <path d="M14 2.5V6c0 .943 0 1.414.293 1.707C14.586 8 15.057 8 16 8h3" />
      <path d="M9 13.5h6M9 17h4" />
    </SolarIcon>
  );
}

/**
 * Marks a named section. A `#` from the page font rather than a drawn glyph:
 * the icon sets all carry a wide, sheared hashtag, and at 17px it reads as a
 * smear next to the upright strokes of the icons beside it.
 */
function HashIcon() {
  return (
    <span className="flex size-[1.05rem] items-center justify-center text-[0.95rem] leading-none">
      #
    </span>
  );
}

/** Marks prose from the page. Solar "List 1", read here as a paragraph. */
function ParagraphIcon() {
  return (
    <SolarIcon className="size-[1.05rem]">
      <path d="M20 7H4M15 12H4M9 17H4" />
    </SolarIcon>
  );
}

/**
 * The plural and the singular of one word, so a query and the page can differ
 * by an `s` and still highlight. Deliberately only the -s family: stripping
 * -ing and -ed as well merges words that mean different things in this corpus.
 */
function forms(word: string): string[] {
  if (word.length <= 3) return [word];
  if (word.endsWith("ies")) return [word, `${word.slice(0, -3)}y`];
  if (word.endsWith("es") && /[sxzh]$/.test(word.slice(0, -2))) return [word, word.slice(0, -2)];
  if (word.endsWith("s") && !/(ss|is|us)$/.test(word)) return [word, word.slice(0, -1)];
  return [word, `${word}s`];
}

/**
 * The query, marked wherever it appears in the excerpt — so the reader can
 * see WHY a page matched without reading the whole line.
 *
 * The trailing `\w*` catches `point` inside `pointattrib`, and `forms` catches
 * the other direction, `properties` against the word `property` on the page.
 */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
    const terms = [...new Set(words.flatMap(forms))].sort((a, b) => b.length - a.length);
    if (!terms.length) return [text];
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return text.split(new RegExp(`(\\b(?:${escaped.join("|")})\\w*)`, "gi"));
  }, [text, query]);

  // split() with one capture group alternates: text, match, text, match…
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          // Colour alone marks the match: one grey step above the excerpt, never title ink.
          <mark key={i} className="bg-transparent text-muted-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The name on a result row. A command row in the overlay uses it too. */
export const ROW_TITLE = "text-sm leading-5 font-medium dark:font-normal";

export function SearchResultRow({
  title,
  category,
  summary,
  icon,
  active,
  sub,
  subKind,
  excerpt,
  query,
  onClick,
  onMouseMove,
}: {
  /** Empty on a prose hit, which shows its excerpt alone. */
  title: string;
  category: string;
  /** What the page says it is, under its title. */
  summary?: string | null;
  icon?: string | null;
  active: boolean;
  /** Render as a hit nested under the page row above it. */
  sub?: boolean;
  /** What kind of nested hit: a named section, or prose from the page. */
  subKind?: "heading" | "text";
  /** Matching prose, shown under the sub-row title. */
  excerpt?: string;
  /** What the reader typed, marked inside the excerpt. */
  query?: string;
  onClick: (event: React.MouseEvent) => void;
  onMouseMove: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  // One column for the mark and one for the words, in every row: a page's
  // icon and a nested hit's glyph share an axis, and so do all the titles.
  // The active row is a flat fill from edge to edge: nothing round sits
  // around it, so it has no corner and no gutter.
  const row = cn(
    "flex w-full items-start gap-ms text-left transition-colors duration-(--duration-fast) motion-reduce:transition-none",
    "px-md",
    active && "bg-muted",
  );
  const press = { onClick, onMouseMove };

  if (sub) {
    return (
      <button type="button" className={cn(row, "py-xs")} {...press}>
        <span aria-hidden="true" className="grid h-[1.125rem] w-5 shrink-0 place-items-center text-muted-foreground/50">
          {subKind === "text" ? <ParagraphIcon /> : <HashIcon />}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          {title && <span className="truncate text-xs text-muted-foreground">{title}</span>}
          {excerpt && (
            <span className="truncate text-xs leading-snug text-muted-foreground/70">
              {query ? <Highlight text={excerptText(excerpt)} query={query} /> : excerptText(excerpt)}
            </span>
          )}
        </span>
      </button>
    );
  }

  // A broken icon URL falls back to the placeholder rather than pulsing a
  // skeleton forever, so the icon column stays the same width on every row.
  const hasImage = Boolean(icon) && !errored;

  return (
    <button type="button" className={cn(row, "py-sm")} {...press}>
      {/* The placeholder is what sits in the slot until the icon arrives, and
          what stays there if it never does. */}
      <span className="relative size-5 shrink-0">
        <span className={`absolute inset-0 transition-opacity ${loaded ? "opacity-0" : "opacity-100"}`}>
          <DocumentIcon />
        </span>
        {hasImage && (
          <img
            src={iconUrl(icon!)}
            alt=""
            aria-hidden="true"
            className={`relative size-5 shrink-0 select-none transition-opacity ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-ms">
          <span className={cn("truncate", ROW_TITLE)}>{title}</span>
          {category && <span className="ml-auto max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{category}</span>}
        </span>
        {summary && <span className="truncate text-xs text-muted-foreground">{summary}</span>}
      </span>
    </button>
  );
}
