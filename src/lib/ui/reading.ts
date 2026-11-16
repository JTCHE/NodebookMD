/**
 * How a docs page reads: its text size and its measure. Each is a root
 * attribute, `data-text` and `data-measure`, and `globals.css` does the rest.
 * Kept in the browser, as the theme is, so the help pane reads it too.
 */
import { useSyncExternalStore } from "react";

export type TextSize = "small" | "default" | "large";
export type Measure = "narrow" | "default" | "wide";

export const TEXT_SIZES: TextSize[] = ["small", "default", "large"];
export const MEASURES: Measure[] = ["narrow", "default", "wide"];

export const TEXT_SIZE_LABEL: Record<TextSize, string> = { small: "Small", default: "Default", large: "Large" };
export const MEASURE_LABEL: Record<Measure, string> = { narrow: "Narrow", default: "Default", wide: "Wide" };

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

function paint() {
  document.documentElement.dataset.text = read(TEXT_KEY, TEXT_SIZES);
  document.documentElement.dataset.measure = read(MEASURE_KEY, MEASURES);
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
    if (value === "default") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // A blocked store loses the choice at the end of the session only.
  }
  paint();
}

export const setTextSize = (choice: TextSize) => write(TEXT_KEY, choice);
export const setMeasure = (choice: Measure) => write(MEASURE_KEY, choice);

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export const useTextSize = () => useSyncExternalStore(subscribe, () => read(TEXT_KEY, TEXT_SIZES), () => "default" as TextSize);
export const useMeasure = () => useSyncExternalStore(subscribe, () => read(MEASURE_KEY, MEASURES), () => "default" as Measure);
