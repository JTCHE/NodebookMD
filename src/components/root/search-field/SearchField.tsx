import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { pastedAnchor, pastedPath, rememberSearch, resolve } from "@/lib/search";
import { useSearch } from "@/lib/use-search";
import { scopedInput } from "@/lib/scope";
import { ScopeChip } from "@/components/search/ScopeChip";
import { isCommand, isTyping, useHotkey } from "@/lib/hotkeys";
import {
  SEARCH_DROPDOWN_CLASS,
  SearchResultList,
  rowPath,
  toRows,
} from "@/components/search/SearchResultList";
import { AnimatedPlaceholder } from "./AnimatedPlaceholder";
import { PasteSearchButton } from "./PasteSearchButton";
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

  const { hits } = useSearch(query);
  const field = scopedInput(query, changeQuery);
  // The list opens on its own when there is something to show, and stays shut
  // until the next answer once the reader dismisses it.
  const open = !closed && hits.length > 0;

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
      setError(`Nothing in this Houdini build matches “${wanted}”.`);
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
    setQuery(value);
    setError("");
  }

  async function pasteAndSearch() {
    const text = await navigator.clipboard.readText().catch(() => "");
    if (!text.trim()) return;
    changeQuery(text);
    // A pasted link is a destination, so it opens without waiting for the list.
    if (pastedPath(text) !== text.trim()) void submit(text);
  }

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
    <div ref={containerRef} className={cn("relative -mr-xs -ml-ms lg:-ml-md", className)}>
      {error && (
        <p id={errorId} className="mb-sm ml-ms text-meta text-destructive lg:ml-md">
          {error}
        </p>
      )}

      <form
        onSubmit={handleSubmit}
        role="search"
        className={cn(
          "relative isolate flex items-center gap-sm overflow-hidden rounded-xl",
          "bg-surface-sunken shadow-field",
          // Two edge lines, one bevel. Call `d` the step the fill sits below
          // the page. The OUTER line is a further `d` down — the page falling
          // away — and the INNER line is the page value itself, the lit lip of
          // the recess. Light mode gets both from the ramp directly. Dark mode
          // cannot: below its page there is only black, and a 1px line the
          // strict rule's width disappears on an emissive screen, so the lip
          // takes the next step up the ramp instead of the page step.
          "border border-hairline dark:border-black",
          "ring-1 ring-inset ring-neutral-0 dark:ring-neutral-100",
          // The focus ring the field takes on behalf of the input it holds.
          "has-[input:focus-visible]:ring-1 has-[input:focus-visible]:ring-neutral-200",
          "py-xs pr-xs pl-md",
        )}
      >
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
            "pointer-events-none absolute inset-0 rounded-xl",
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
            aria-describedby={error ? errorId : undefined}
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

      {open && (
        <SearchResultList
          hits={hits}
          query={field.text}
          selected={selected}
          onSelect={setSelected}
          onActivate={(row, rank, event) => {
            tell(rank);
            rememberSearch(row.hit);
            go(rowPath(row), row.section?.excerpt, event ? tabFor(event) : null);
          }}
          className={cn("absolute top-full right-0 left-0 z-10", SEARCH_DROPDOWN_CLASS)}
        />
      )}
    </div>
  );
}
