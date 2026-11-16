/**
 * How a docs page reads: its text size and its measure. The size is a root
 * attribute, `data-text`; the measure is a root variable, `--measure`, in
 * `ch`. `globals.css` does the rest.
 * Kept in the browser, as the theme is, so the help pane reads it too.
 */
import { useSyncExternalStore } from "react";

export type TextSize = "small" | "default" | "large";

export const TEXT_SIZES: TextSize[] = ["small", "default", "large"];
export const TEXT_SIZE_LABEL: Record<TextSize, string> = { small: "Small", default: "Default", large: "Large" };

/** The measure, in `ch` of Geist. 72ch is about 105 characters of prose. */
export const MEASURE_MIN = 52;
export const MEASURE_MAX = 104;
export const MEASURE_DEFAULT = 72;
/** Characters of prose in one `ch`, for the reader's own unit. */
export const CHARACTERS_PER_CH = 105 / 72;

const TEXT_KEY = "nodebookmd.text-size";
const MEASURE_KEY = "nodebookmd.measure";

function read<T extends string>(key: string, choices: readonly T[]): T {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && choices.includes(value) ? value : ("default" as T);
  } catch {
    return "default" as T;
  }
}

const listeners = new Set<() => void>();

function readMeasure(): number {
  try {
    const value = Number(window.localStorage.getItem(MEASURE_KEY));
    return value >= MEASURE_MIN && value <= MEASURE_MAX ? value : MEASURE_DEFAULT;
  } catch {
    return MEASURE_DEFAULT;
  }
}

function paint() {
  document.documentElement.dataset.text = read(TEXT_KEY, TEXT_SIZES);
  document.documentElement.style.setProperty("--measure", `${readMeasure()}ch`);
  for (const notify of listeners) notify();
}

/** Called once, from `main.tsx`, before the first paint. */
export function startReading() {
  paint();
  window.addEventListener("storage", (event) => {
    if (event.key === TEXT_KEY || event.key === MEASURE_KEY) paint();
  });
}

function write(key: string, value: string) {
  try {
    if (value === "default" || value === String(MEASURE_DEFAULT)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // A blocked store loses the choice at the end of the session only.
  }
  paint();
}

export const setTextSize = (choice: TextSize) => write(TEXT_KEY, choice);
export const setMeasure = (measure: number) => write(MEASURE_KEY, String(measure));

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export const useTextSize = () => useSyncExternalStore(subscribe, () => read(TEXT_KEY, TEXT_SIZES), () => "default" as TextSize);
export const useMeasure = () => useSyncExternalStore(subscribe, readMeasure, () => MEASURE_DEFAULT);
