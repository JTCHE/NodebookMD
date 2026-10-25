/**
 * Light or dark, and who decides.
 *
 * The reader chooses light, dark or system, and the choice is kept on the
 * machine. System is the default: the system decides and keeps deciding — a
 * reader who switches Windows to dark at sunset gets a dark window without
 * touching the app.
 *
 * The root attribute is the whole of the theme: `globals.css` states the dark
 * ramp under `:root[data-theme="dark"]`, so a switch is one attribute write
 * and no re-render.
 */
import { useSyncExternalStore } from "react";
import { inTauri } from "@/lib/backend";
import { Icons } from "@/lib/ui/icons";

export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "system";

/** The choices in the order the footer button steps through them. The
    settings and the command list read the same list. */
export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "system"];

export const THEME_LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };

export const THEME_ICON = { light: Icons.themeLight, dark: Icons.themeDark, system: Icons.themeSystem } satisfies Record<
  ThemeChoice,
  unknown
>;

const KEY = "nodebookmd.theme";

function stored(): Theme | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

/** Houdini's help pane is a panel of a dark application, and its browser
    reports light whatever Windows says. There the default is dark. */
function system(): Theme {
  if (!inTauri) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function current(): Theme {
  return stored() ?? system();
}

function paint(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

const listeners = new Set<() => void>();

/** Sets the theme before the first paint, and follows the system while the
    reader has not chosen. Called once, from `main.tsx`. */
export function startTheme() {
  paint(current());
  // Paper is white, so a print is always the light theme.
  window.addEventListener("beforeprint", () => paint("light"));
  window.addEventListener("afterprint", () => paint(current()));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (stored()) return;
    paint(system());
    for (const notify of listeners) notify();
  });
  // Another window of the same origin switched: this one follows.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    paint(current());
    for (const notify of listeners) notify();
  });
}

/** The reader's choice, from now on. System is no stored value at all. */
export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // A blocked store loses the choice at the end of the session, not the
    // switch itself.
  }
  paint(choice === "system" ? system() : choice);
  for (const notify of listeners) notify();
}

/** The next choice after the one in force. */
export function cycleTheme() {
  const at = THEME_CHOICES.indexOf(stored() ?? "system");
  setTheme(THEME_CHOICES[(at + 1) % THEME_CHOICES.length]);
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

/** The reader's choice, live. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    subscribe,
    () => stored() ?? "system",
    () => "system" as ThemeChoice,
  );
}
