/**
 * Zoom keys on macOS and Linux: ⌘ or Ctrl with + and - and 0, and the pinch.
 *
 * Tauri's own script compares the typed character with "0", and a French
 * keyboard types "à" on that key, so reset never fired there. The physical
 * key counts here too. On Windows the webview zooms by itself, on every
 * layout. See `window()` in src-tauri/src/lib.rs.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IS_MAC } from "@/lib/hotkeys";

const STEP = 0.1;
const MIN = 0.5;
const MAX = 3;

let level = 1;

function zoom(next: number) {
  level = Math.round(Math.min(MAX, Math.max(MIN, next)) * 100) / 100;
  void getCurrentWebview().setZoom(level).catch(() => {});
}

/** Called once, from main.tsx, in the desktop window off Windows. */
export function startZoomKeys() {
  window.addEventListener("keydown", (event) => {
    if (!(IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey) || event.altKey) return;
    const { key, code } = event;
    let next: number | null = null;
    if (key === "0" || code === "Digit0" || code === "Numpad0") next = 1;
    else if (key === "=" || key === "+" || code === "NumpadAdd") next = level + STEP;
    else if (key === "-" || code === "NumpadSubtract") next = level - STEP;
    if (next === null) return;
    event.preventDefault();
    zoom(next);
  });
  // A pinch on a trackpad arrives as a wheel with Ctrl held.
  window.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      zoom(level - Math.sign(event.deltaY) * STEP);
    },
    { passive: false },
  );
}
