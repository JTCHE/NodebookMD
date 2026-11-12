/**
 * The drop-down menu of the page header: its look and its keys, in one place,
 * so the page actions and the node version list cannot drift apart.
 */
import { useEffect, useRef, useState } from "react";
import { ROW_INTERACTION } from "./interactive";

export const MENU_PANEL =
  "absolute top-[calc(100%+4px)] right-0 z-50 origin-top-right rounded-lg border border-hairline bg-raised p-1 " +
  "shadow-xl shadow-black/10 pop-in";

export const MENU_ITEM =
  "flex w-full items-center gap-2.5 rounded-md px-sm py-[7px] text-left text-[13px] text-neutral-800 " + ROW_INTERACTION;

export const MENU_ICON = "size-3.5 shrink-0 text-neutral-500";

const ITEMS = "[role=menuitem], [role=option]";

/**
 * The menu opens with the focus on the chosen item, or on the first, and
 * closes on a click outside it or on Escape, which gives the focus back to the
 * button that opened it. The focus waits one frame: the click that opened the
 * menu focuses the button after this effect has run.
 *
 * `onKeyDown` goes on the whole control, not the menu, so the keys also work
 * while the focus is still on the button.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const list = menu.current;
      (list?.querySelector<HTMLElement>("[aria-selected=true]") ?? list?.querySelector<HTMLElement>(ITEMS))?.focus();
    });
    const outside = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", outside);
    };
  }, [open]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return { open, setOpen, container, menu, trigger, onKeyDown };
}

/** Words too small to name an item by. */
const MINOR = new Set(["a", "an", "as", "at", "in", "of", "on", "the", "to"]);

/**
 * The letter that runs each item of a menu, as its place in the label, or -1.
 *
 * A word's first letter says the most, so every item tries the first letter of
 * each of its words before any other letter, one round at a time: "Copy link"
 * takes L, the start of its second word, rather than the O of "Copy". Within a
 * round the item with the fewest words goes first, because the shorter label
 * is the plain action — "Copy" gets C before "Copy link address" can.
 */
// ponytail: greedy rounds, not an optimal match; a menu of ten items needs no more.
export function accelerators(labels: string[]): number[] {
  const tries = labels.map((label) => {
    const words = [...label.matchAll(/[A-Za-z][A-Za-z.]*/g)].filter((word) => !MINOR.has(word[0].toLowerCase()));
    const starts = words.map((word) => word.index);
    // Then the other letters, the last word first — it is the one that tells
    // two items apart — and consonants before vowels.
    const rest = words
      .toReversed()
      .flatMap((word) => [...word[0]].map((letter, i) => ({ letter, at: word.index + i })).slice(1))
      .filter(({ letter }) => /[a-z]/i.test(letter))
      .sort((a, b) => Number(/[aeiouy]/i.test(a.letter)) - Number(/[aeiouy]/i.test(b.letter)))
      .map(({ at }) => at);
    return { words: words.length, order: [...starts, ...rest] };
  });
  const taken = new Set<string>();
  const found = labels.map(() => -1);
  const byLength = labels.map((_, i) => i).sort((a, b) => tries[a].words - tries[b].words);
  const rounds = Math.max(0, ...tries.map((t) => t.order.length));
  for (let round = 0; round < rounds; round++) {
    for (const i of byLength) {
      const at = tries[i].order[round];
      if (found[i] >= 0 || at === undefined) continue;
      const letter = labels[i][at].toLowerCase();
      if (taken.has(letter)) continue;
      taken.add(letter);
      found[i] = at;
    }
  }
  return found;
}
