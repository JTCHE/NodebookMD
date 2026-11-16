import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { pastedAnchor, pastedPath, rememberSearch, resolve } from "@/lib/search";
import { useSearch } from "@/lib/use-search";
import { scopedInput, searchQuotes } from "@/lib/scope";
import { ScopeChip } from "@/components/search/ScopeChip";
import { isCommand, isTyping, useHotkey, usePagePaste } from "@/lib/hotkeys";
import {
  SEARCH_LIST_CLASS,
  SearchResultList,
  rowPath,
  toRows,
} from "@/components/search/SearchResultList";
import { AnimatedPlaceholder } from "./AnimatedPlaceholder";
import { PasteSearchButton } from "./PasteSearchButton";
import { SearchHints } from "@/components/search/SearchHints";
import { FADE_OUT, useOverflow } from "@/lib/ui/overflow";
import { useSearchReport } from "@/lib/telemetry";
import { openTab, tabFor } from "@/lib/tabs";

/**
 * The search field: one input, one key, and the list it opens.
 *
 * The search itself is `useSearch`, shared with the overlay a page opens.
 */
export function SearchField({ className, autoFocus = true }: { className?: string; autoFocus?: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const errorId = useId();

  const { hits, settled } = useSearch(query);
  const field = scopedInput(query, changeQuery);
  // An answer with no page in it is said in the panel, where the list would
  // be: the reader sees it as they type and nothing above the field moves.
  const nothing = error || (settled && hits.length === 0 && query.trim() ? `No page matches “${field.text.trim()}”.` : "");
  // The panel opens on its own when there is something to show, and stays
  // shut until the next answer once the reader dismisses it.
  const open = !closed && (hits.length > 0 || Boolean(nothing));
  // What the panel holds stays while it closes, so it folds away with its
  // rows in it and does not blink out a frame before.
  const answer = { hits, nothing, text: field.text };
  const kept = useRef(answer);
  if (open) kept.current = answer;
  const panel = kept.current;
  const panelRef = useRef<HTMLDivElement>(null);
  useOverflow(panelRef, [panel.hits, open]);

  // The list expands each page into its matching sections, so the arrow keys
  // count rows and not results.
  const rows = toRows(hits);

  // A new answer re-opens the list and puts the selection back on its first
  // row, during render rather than in an effect.
  const [shown, setShown] = useState(hits);
  if (hits !== shown) {
    setShown(hits);
    setSelected(0);
    setClosed(false);
  }

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    // Mount only: refocusing on every render would fight the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  // ⌘K anywhere on this page puts the caret back in the field and selects what
  // is already typed, so the next word replaces it.
  useHotkey((event) => {
    if (!isCommand(event) || event.key !== "k") return;
    event.preventDefault();
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  // A letter or a digit typed anywhere else on this page goes to the field,
  // as the overlay takes it on a doc page. Focused during the key down, the
  // field gets the key's character itself.
  useHotkey((event) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!/^[\p{L}\p{N}]$/u.test(event.key) || isTyping(target)) return;
    if (target.closest("[role=menu], [role=listbox], [role=dialog]")) return;
    inputRef.current?.focus();
  });

  useEffect(() => {
    function closeOnOutsidePress(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setClosed(true);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, []);

  const tell = useSearchReport(query, hits.length);
  // A list the reader closed without opening a row is the case that says the
  // search fell short, so it is reported too.
  useEffect(() => {
    if (closed) tell(-1);
  }, [closed, tell]);

  /** `find` is the excerpt of a row, which the page opens at and marks. */
  function go(path: string, find?: string, tab: { background: boolean } | null = null) {
    const entryState = find ? { find } : undefined;
    // A tab behind leaves the list open, for the next pick.
    if (tab) {
      if (!tab.background) setClosed(true);
      openTab(`/${path}`, { ...tab, entryState });
      return;
    }
    setClosed(true);
    navigate(`/${path}`, { state: entryState });
  }

  /**
   * Everything typed goes through here, so nothing can navigate on a guess.
   * A path or a pasted link names a page; anything else has to be a row of the
   * list. Text that is neither says so and stays put — opening `/cptp` and
   * letting the page report itself missing tells the reader their query is
   * wrong when the search is what fell short.
   */
  async function submit(text: string, tab: { background: boolean } | null = null) {
    const wanted = text.trim();
    if (!wanted) return;
    const hit = await resolve(wanted, rows[selected]?.hit);
    if (!hit) {
      setError(`No page matches “${wanted}”.`);
      setClosed(false);
      tell(-1);
      return;
    }
    tell(rows.findIndex((row) => row.hit.path === hit.path));
    // A row of the list may name a heading of the page, not only the page.
    const row = open && rows[selected]?.hit === hit ? rows[selected] : null;
    rememberSearch(hit);
    // A pasted link keeps the section it names.
    go(row ? rowPath(row) : `${hit.path}${pastedAnchor(wanted)}`, row?.section?.excerpt, tab);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(query);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setClosed(true);
      return;
    }
    // Ctrl+Enter: the same pick, in a new tab. The form's own submit does
    // not say which keys were held.
    const tab = event.key === "Enter" ? tabFor(event, true) : null;
    if (tab) {
      event.preventDefault();
      void submit(query, tab);
      return;
    }
    if (!open || rows.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((current) => (current + step + rows.length) % rows.length);
    }
  }

  function changeQuery(value: string) {
    setQuery(searchQuotes(value));
    setError("");
  }

  function pasted(text: string) {
    if (!text.trim()) return;
    changeQuery(text);
    inputRef.current?.focus();
    // A pasted link is a destination, so it opens without waiting for the list.
    if (pastedPath(text) !== text.trim()) void submit(text);
  }

  async function pasteAndSearch() {
    pasted(await navigator.clipboard.readText().catch(() => ""));
  }

  // Ctrl+V anywhere else on this page does what the paste button does.
  usePagePaste(pasted);

  const mode = query.trim() ? "search" : "paste";
  // One word in both modes. The button changes what it DOES on an empty field
  // — it reads the clipboard first — but saying so on the cap made the widest
  // label the resting one, and the placeholder beside it already offers the
  // paste ("…or paste a SideFX URL").
  const buttonLabel = "Search";

  return (
    // The field overhangs its column by exactly its own padding, so the input
    // text sits on the same left axis as the text above it and only the
    // surface reaches past.
    // The box keeps the height of the closed field, and the surface grows
    // out of it over the page below, so nothing under the field moves.
    <div ref={containerRef} className={cn("relative z-10 -mr-xs -ml-ms h-12 lg:-ml-md", className)}>
     {/* One surface: the field, and under it the answer. Closed, it is a well
         in the page. Open, it lifts to a panel and the well's shading goes. */}
     <div
        data-open={open}
        className={cn(
          "group/search absolute inset-x-0 top-0 isolate overflow-hidden rounded-xl",
          "bg-neutral-100 shadow-field dark:bg-neutral-0",
          // Dark has no darker fill to sink to, so the top wall casts its shade on the floor.
          "dark:inset-shadow-[0_2px_5px_0_oklch(0_0_0/55%)]",
          "data-[open=true]:bg-popover data-[open=true]:shadow-pane dark:data-[open=true]:bg-popover dark:data-[open=true]:inset-shadow-none",
          "transition-[background-color,box-shadow] duration-(--duration-base) ease-out-quint motion-reduce:transition-none",
          // Two edge lines, one bevel. Call `d` the step the fill sits below
          // the page. The OUTER line is a further `d` down — the page falling
          // away — and the INNER line is the page value itself, the lit lip of
          // the recess. Light mode gets both from the ramp directly. Dark mode
          // cannot: below its page there is only black, and a 1px line the
          // strict rule's width disappears on an emissive screen, so the lip
          // takes the next step up the ramp instead of the page step.
          "border border-hairline dark:border-black dark:data-[open=true]:border-hairline",
          "ring-1 ring-inset ring-neutral-0 dark:ring-neutral-100",
          // The focus ring the field takes on behalf of the input it holds.
          "has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-neutral-200",
        )}
      >
      <form onSubmit={handleSubmit} role="search" className="relative flex h-[46px] items-center gap-sm py-xs pr-xs pl-md">
        {/* Depth across the fill, straight off the design: the two ends and a
            flat plateau between 38% and 60%. The plateau is what keeps it a
            shallow band rather than a sweep. The geometry is one shape in both
            themes — only the ink and the blend differ, and both are local to
            this element. The two variables name POSITIONS, not roles: `ends` is
            the pair at 10.9% and 89.5%, `plateau` is the flat run between them.
            Which of the two carries the light is what each theme decides, so
            inverting a theme is a swap of ink and never a second gradient.

            Light lights the ends and sinks the plateau. Dark does the reverse —
            light glancing along the floor of the well — and stops carrying ink
            at the ends at all.

            Light mode blends: on a near-white fill soft-light is well behaved
            and gives the shading for free. On the near-black dark fill it is
            not — the curve is close to vertical there, so the layer either does
            nothing or blows out, with nothing in between. Dark mode therefore
            paints instead, lifting by a stated 2%.

            The gradient is a style rather than gradient utilities because
            Tailwind carries one `via` and this needs two middle stops. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-(--duration-base) group-data-[open=true]/search:opacity-0 motion-reduce:transition-none",
            "mix-blend-soft-light dark:mix-blend-normal",
            "[--sheen-ends:oklch(1_0_0/50%)] [--sheen-plateau:oklch(0_0_0/50%)]",
            "dark:[--sheen-ends:transparent] dark:[--sheen-plateau:oklch(1_0_0/2%)]",
          )}
          style={{
            backgroundImage:
              "linear-gradient(97.19deg, var(--sheen-ends) 10.9%, var(--sheen-plateau) 38.2%, var(--sheen-plateau) 60.2%, var(--sheen-ends) 89.5%)",
          }}
        />

        <div className="relative flex min-w-0 flex-1 items-center gap-2">
          {field.scope && <ScopeChip scope={field.scope} />}
          <input
            ref={inputRef}
            type="text"
            value={field.text}
            onChange={(event) => field.change(event.target.value)}
            onKeyDown={(event) => {
              if (!field.key(event)) handleKeyDown(event);
            }}
            aria-label="Search the Houdini documentation"
            aria-invalid={!!error}
            aria-describedby={open && nothing ? errorId : undefined}
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="off"
            spellCheck={true}
            className={cn(
              "w-full min-w-0 border-0 bg-transparent text-label text-sm text-foreground shadow-none outline-none",
              "placeholder:text-transparent disabled:cursor-wait",
            )}
          />
          {!query && <AnimatedPlaceholder />}
        </div>

        <PasteSearchButton mode={mode} label={buttonLabel} onPaste={() => void pasteAndSearch()} />
      </form>

      {/* The rows fold: a grid row that goes from nothing to its content's
          height is the one way to animate to a height nobody stated. Fast, and
          the rows take a press from the first frame. */}
      <div
        inert={!open}
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] transition-[grid-template-rows] duration-(--duration-base) ease-out-quint motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        {/* While it folds, the rows fade out at the moving edge; a hard cut
            there would slice a row in two. See `fold-fade` in globals.css. */}
        <div className="fold-fade min-h-0 overflow-clip">
          {panel.hits.length > 0 ? (
            <div className="border-t border-hairline">
              <div ref={panelRef} className={cn("scroll-pt-5 scroll-pb-10 [scrollbar-width:none]!", SEARCH_LIST_CLASS, FADE_OUT, "[--fade-size:40px] [--fade-head-size:20px]")}>
                <SearchResultList
                  hits={panel.hits}
                  query={panel.text}
                  // The chip in the field already names the part of the docs.
                  withCategory={!field.scope}
                  selected={selected}
                  onSelect={setSelected}
                  onActivate={(row, rank, event) => {
                    tell(rank);
                    rememberSearch(row.hit);
                    go(rowPath(row), row.section?.excerpt, event ? tabFor(event) : null);
                  }}
                />
              </div>
              <SearchHints className="px-md py-sm">
                <span>{panel.hits.length === 1 ? "1 page" : `${panel.hits.length} pages`}</span>
              </SearchHints>
            </div>
          ) : (
            panel.nothing && (
              // On the field's text axis, at a row's height: the list with nothing in it.
              <p id={errorId} role="status" className="truncate border-t border-hairline px-md py-ms text-sm text-muted-foreground">
                {panel.nothing}
              </p>
            )
          )}
        </div>
      </div>
     </div>
    </div>
  );
}
