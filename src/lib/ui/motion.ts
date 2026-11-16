/**
 * Reduce motion: on, off, or as the system says.
 *
 * Like the theme, the root attribute is the whole of it. `data-motion` is
 * `reduce` or `full`, always written, so `globals.css` (the `motion-reduce:`
 * and `motion-safe:` variants) and `reducedMotion()` read one value and never
 * the media query.
 */
import { useSyncExternalStore } from "react";

export type MotionChoice = "system" | "reduce" | "full";

export const MOTION_CHOICES: MotionChoice[] = ["system", "reduce", "full"];

export const MOTION_LABEL: Record<MotionChoice, string> = { system: "System", reduce: "On", full: "Off" };

const KEY = "nodebookmd.motion";
const QUERY = "(prefers-reduced-motion: reduce)";

function stored(): MotionChoice {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "reduce" || value === "full" ? value : "system";
  } catch {
    return "system";
  }
}

function paint() {
  const choice = stored();
  const reduce = choice === "system" ? window.matchMedia(QUERY).matches : choice === "reduce";
  document.documentElement.dataset.motion = reduce ? "reduce" : "full";
}

const listeners = new Set<() => void>();

function repaint() {
  paint();
  for (const notify of listeners) notify();
}

/** Called once, from `main.tsx`, before the first paint. */
export function startMotion() {
  paint();
  window.matchMedia(QUERY).addEventListener("change", repaint);
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) repaint();
  });
}

export function setMotion(choice: MotionChoice) {
  try {
    if (choice === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, choice);
  } catch {
    // A blocked store loses the choice at the end of the session only.
  }
  repaint();
}

/** Whether motion is reduced now. */
export function reducedMotion(): boolean {
  return document.documentElement.dataset.motion === "reduce";
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useMotionChoice(): MotionChoice {
  return useSyncExternalStore(subscribe, stored, () => "system" as MotionChoice);
}
