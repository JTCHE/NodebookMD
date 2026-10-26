/**
 * The find bar: ⌘F or Ctrl F, a field, the count, the arrows to step.
 *
 * It searches what is being read, the `main` of the route, and marks the
 * matches without an element in the page. See lib/ui/find.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { BAR_BUTTON } from "@/lib/ui/button";
import { Hint } from "@/components/ui/Hint";
import { IS_MAC, isCommand, letterOf, useHotkey } from "@/lib/hotkeys";
import { clearPaint, findRanges, nearest, paint, reveal } from "@/lib/ui/find";

export function FindBar() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  // -1 until the reader types or steps: opening the bar again marks the words
  // and leaves the page where it is.
  const [current, setCurrent] = useState(-1);
  const typed = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const step = (by: 1 | -1) => {
    if (ranges.length === 0) return;
    const next = current < 0 ? nearest(ranges, by) : (current + by + ranges.length) % ranges.length;
    setCurrent(next);
    reveal(ranges[next]);
  };

  const close = () => {
    setOpen(false);
    clearPaint();
  };

  useHotkey((event) => {
    // ⌘F opens the bar, or takes the caret back to it, with the words selected.
    if (isCommand(event) && !event.shiftKey && letterOf(event) === "f") {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => {
        input.current?.focus();
        input.current?.select();
      });
      return;
    }
    if (!open) return;
    // The keys each platform steps a find with: ⌘G on macOS, F3 elsewhere.
    const again = IS_MAC ? isCommand(event) && letterOf(event) === "g" : event.key === "F3";
    if (again) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  });

  // The matches, again each time the words or the page change. Typed words go
  // to the match nearest the view, as in a browser; a bar opened again, or a
  // new page, picks none and does not scroll.
  useEffect(() => {
    if (!open) return;
    let frame = 0;
    let first = true;
    const run = () => {
      const root = document.querySelector("main");
      const found = root ? findRanges(root, query) : [];
      setRanges(found);
      if (!first) return setCurrent((was) => Math.min(was, found.length - 1));
      first = false;
      const at = typed.current ? nearest(found, 1) : -1;
      typed.current = false;
      setCurrent(at);
      if (found[at]) reveal(found[at]);
    };
    run();
    // A page that draws after the bar opened, or a section that opens.
    const watch = new MutationObserver((records) => {
      if (records.every((record) => bar.current?.contains(record.target))) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, query, location.key]);

  useEffect(() => {
    if (open) paint(ranges, current);
  }, [open, ranges, current]);
  useEffect(() => clearPaint, []);

  if (!open) return null;
  const count = query ? `${current < 0 ? (ranges.length ? "–" : 0) : current + 1}/${ranges.length}` : "";
  return (
    <div
      ref={bar}
      role="search"
      className={cn(
        "absolute top-sm right-ms z-40 flex w-[min(400px,calc(100%-2*var(--spacing-ms)))] items-center gap-xs print:hidden",
        // The popover ground, a step above the page: the raised one read too light
        // on the dark theme.
        "rounded-xl border border-hairline bg-popover p-sm shadow-pane",
        "transition-[opacity,translate] duration-(--duration-fast) ease-out motion-reduce:transition-none",
        "starting:-translate-y-1 starting:opacity-0",
      )}
    >
      <Icons.search className="ml-sm size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        ref={input}
        value={query}
        onChange={(event) => {
          typed.current = true;
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        placeholder="Find in page"
        aria-label="Find in page"
        spellCheck={false}
        className="h-8 min-w-0 flex-1 bg-transparent px-xs text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      <span aria-live="polite" className="shrink-0 px-xs text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
      <span className="mx-2xs h-4 w-px shrink-0 bg-hairline" aria-hidden="true" />
      <Hint label="Previous match" keys={IS_MAC ? "⇧+⌘+G" : "Shift+F3"}>
        <button type="button" aria-label="Previous match" disabled={ranges.length === 0} onClick={() => step(-1)} className={BAR_BUTTON}>
          <Icons.findPrevious className="size-4" />
        </button>
      </Hint>
      <Hint label="Next match" keys={IS_MAC ? "⌘+G" : "F3"}>
        <button type="button" aria-label="Next match" disabled={ranges.length === 0} onClick={() => step(1)} className={BAR_BUTTON}>
          <Icons.findNext className="size-4" />
        </button>
      </Hint>
      <Hint label="Close" keys="Esc">
        <button type="button" aria-label="Close" onClick={close} className={BAR_BUTTON}>
          <Icons.dismiss className="size-4" />
        </button>
      </Hint>
    </div>
  );
}
