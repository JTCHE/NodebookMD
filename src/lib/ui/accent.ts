/**
 * The accent: the colour of links, the chosen row's marks and the brand
 * buttons. It is a hue and a strength, two root variables that
 * `globals.css` reads into `--brand` and its steps. The choice is kept on
 * the machine.
 */
import { useSyncExternalStore } from "react";

export type Accent = "original" | "monochrome" | "red" | "brand" | "yellow" | "green" | "blue" | "purple" | "pink" | "custom";
/** The default first, as in every choice in Settings. Original is the grey
    app with its trademark orange logo and green tips; Monochrome has no
    colour at all. Then the colours around the wheel, and a hue of your own. */
export const ACCENTS: Accent[] = ["original", "monochrome", "brand", "red", "yellow", "green", "blue", "purple", "pink", "custom"];
export const ACCENT_DEFAULT: Accent = "original";

/** The accents that tint nothing: the greys stay grey. */
export const isGrey = (accent: Accent) => accent === "original" || accent === "monochrome";
export const ACCENT_LABEL: Record<Accent, string> = {
  original: "Original",
  monochrome: "Monochrome",
  red: "Red",
  brand: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
  custom: "Custom",
};

/** The hue of each fixed accent, in oklch degrees. Original and Monochrome have no strength. */
const HUE: Record<Exclude<Accent, "custom">, number> = { original: 52, monochrome: 52, red: 25, brand: 52, yellow: 90, green: 150, blue: 255, purple: 300, pink: 350 };
export const HUE_DEFAULT = 300;

const ACCENT_KEY = "nodebookmd.accent";
const HUE_KEY = "nodebookmd.accent-hue";

function readAccent(): Accent {
  try {
    const value = window.localStorage.getItem(ACCENT_KEY) as Accent | null;
    return value && ACCENTS.includes(value) ? value : ACCENT_DEFAULT;
  } catch {
    return ACCENT_DEFAULT;
  }
}

function readHue(): number {
  try {
    const value = window.localStorage.getItem(HUE_KEY);
    const hue = Number(value);
    return value !== null && hue >= 0 && hue <= 360 ? hue : HUE_DEFAULT;
  } catch {
    return HUE_DEFAULT;
  }
}

/** The hue an accent draws with. */
export function hueOf(accent: Accent, customHue: number): number {
  return accent === "custom" ? customHue : HUE[accent];
}

const listeners = new Set<() => void>();

function paint() {
  const accent = readAccent();
  const root = document.documentElement.style;
  root.setProperty("--accent-hue", String(hueOf(accent, readHue())));
  root.setProperty("--accent-strength", isGrey(accent) ? "0" : "1");
  // Controls read this to take the accent: a switch that is on, a focus ring.
  document.documentElement.dataset.accent = accent;
  for (const notify of listeners) notify();
}

/** Called once, from `main.tsx`, before the first paint. */
export function startAccent() {
  paint();
  window.addEventListener("storage", (event) => {
    if (event.key === ACCENT_KEY || event.key === HUE_KEY) paint();
  });
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // A blocked store loses the choice at the end of the session only.
  }
  paint();
}

export const setAccent = (accent: Accent) => write(ACCENT_KEY, accent === ACCENT_DEFAULT ? null : accent);
export const setHue = (hue: number) => write(HUE_KEY, String(hue));

/** The accent back to its default, and the custom hue back to its default. */
export function resetAccent() {
  write(HUE_KEY, null);
  setAccent(ACCENT_DEFAULT);
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export const useAccent = () => useSyncExternalStore(subscribe, readAccent, () => ACCENT_DEFAULT);
export const useHue = () => useSyncExternalStore(subscribe, readHue, () => HUE_DEFAULT);
