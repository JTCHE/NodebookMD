import { useMemo, useState } from "react";
import { iconUrl } from "@/lib/assets";
import { excerptText } from "@/lib/search";

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
    <span className="flex size-[1.05rem] items-center justify-center text-[0.95rem] leading-none font-medium">
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
 * The query, in bold, wherever it appears in the excerpt — so the reader can
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
          <strong key={i} className="font-semibold text-foreground/75">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function SearchResultRow({
  title,
  category,
  icon,
  active,
  sub,
  subKind,
  excerpt,
  query,
  rounded = true,
  onClick,
  onMouseMove,
}: {
  title: string;
  category: string;
  icon?: string | null;
  active: boolean;
  /** Render as a hit nested under the page row above it. */
  sub?: boolean;
  /** What kind of nested hit: a named section, or prose from the page. */
  subKind?: "heading" | "text";
  /** Matching prose, shown under the sub-row title. */
  excerpt?: string;
  /** What the reader typed, bolded inside the excerpt. */
  query?: string;
  /**
   * Off when the row runs edge to edge (no side gutter around the list): a
   * rounded highlight against a straight-sided panel shows a sliver of
   * background at each corner instead of a clean full-bleed bar.
   */
  rounded?: boolean;
  onClick: (event: React.MouseEvent) => void;
  onMouseMove: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const press = { onClick, onMouseMove };

  if (sub) {
    return (
      <button
        type="button"
        // Rounded like the panel that holds it: a square highlight inside a
        // rounded list reads as a rendering fault at the first and last row.
        className={`flex w-full items-stretch gap-2.5 pr-4 text-left transition-colors ${rounded ? "rounded-lg" : ""} ${
          active ? "bg-muted" : "hover:bg-muted/50"
        }`}
        {...press}
      >
        {/*
          One unbroken rule down the left of the whole group, so a run of hits
          reads as belonging to the page above it. Every nested row draws its
          full height, so consecutive rows join into a single line.
        */}
        <span aria-hidden="true" className="ml-[1.6rem] w-px shrink-0 bg-muted-foreground/25" />

        <span className="flex min-w-0 flex-1 items-start gap-2 py-1.5">
          <span aria-hidden="true" className="mt-px shrink-0 text-muted-foreground/50">
            {subKind === "text" ? <ParagraphIcon /> : <HashIcon />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs text-muted-foreground">{title}</span>
            {excerpt && (
              <span className="line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground/60">
                {query ? <Highlight text={excerptText(excerpt)} query={query} /> : excerptText(excerpt)}
              </span>
            )}
          </span>
        </span>
      </button>
    );
  }

  // A broken icon URL falls back to the placeholder rather than pulsing a
  // skeleton forever, so the icon column stays the same width on every row.
  const hasImage = Boolean(icon) && !errored;

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${rounded ? "rounded-lg" : ""} ${
        active ? "bg-muted" : "hover:bg-muted/50"
      }`}
      {...press}
    >
      {/* The placeholder is what sits in the slot until the icon arrives, and
          what stays there if it never does. The site pulsed a grey box instead,
          which pulses for as long as the window is open when an icon is missing
          from `icons.zip` and the load neither succeeds nor errors. */}
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
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="truncate text-xs text-muted-foreground">{category}</span>
      </span>
    </button>
  );
}
