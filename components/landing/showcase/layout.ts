"use client";

import { useEffect, useLayoutEffect, useState } from "react";

/** Every tab is laid out at this size and scaled to fit, so a demo is drawn
    once, in its own pixels, whatever the screen. */
const DESK = { w: 1200, h: 740 };
/** Below this scale the app's text gets too small to read. A smaller screen
    gets a smaller window instead, down to this one, and the app lays itself
    out in it. */
const LEGIBLE = 0.72;
const SMALLEST = { w: 960, h: 560 };
/** A phone gets a narrow tab as tall as the room left, and the app draws its
    own narrow layout in it: close enough to read, rather than a whole window
    too small to. */
const PHONE = 420;
const NARROW = 640;

/** The least height the app gets on the page, in page pixels. */
export const MIN_AREA = 320;

/** The place of a part in the `enter` order: the parts of a slide come in
    one after the other, as the page's own do. */
export const enter = (order: number) => ({ "--enter": order }) as React.CSSProperties;

/** The frame's corner, on the page. */
export const RADIUS = 10;

/** How long the app takes to move between two tabs that both show it. */
export const MOVE_MS = 500;

/** Panes that fill the frame, as Houdini's do: the gap around and between
    them, and the corner where two meet. */
export const GAP = 4;
export const INNER = 3;
/** The corner of a pane at the frame's own corner: concentric with it. */
export const outerCorner = (base: Base) => Math.max(INNER, base.radius - GAP);

/** The app's own title bar, from the app's `--spacing-titlebar`. */
const TITLEBAR = 32;

export interface Base {
  w: number;
  h: number;
  phone: boolean;
  /** The frame's corner, in the tab's pixels: a box inside the frame that
      meets its corner rounds by this, less its gap, to stay concentric. */
  radius: number;
}

/** Where the app sits in a tab, in the tab's own pixels, and the size of the
    window the app lays itself out in. */
export interface AppBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The width the app thinks its window is. */
  window: number;
  /** Where the page time shows: the middle of the bar above the page, in
      the tab's pixels. */
  bar: number;
  /** The time sits at the bar's right end, not its middle: the pane's tab
      bar has its name on the left. */
  end?: boolean;
  /** Its corners, as CSS, when it does not fill the tab. */
  corners?: string;
}

export interface DemoProps {
  /** Moves the app to `path`, and times the page `title` if one is given. */
  go: (path: string, title?: string) => void;
  /** How long the tab has played, in ms. It stands still while the tour is
      paused or held, so a demo timed by it stops with the tour. */
  clock: () => number;
  base: Base;
}

/** `read` of the tab's clock, each frame. A `read` that gives few values (a
    step number) draws only when it changes. `read` is a module function. */
export function usePlayed<T>(clock: () => number, read: (ms: number) => T) {
  const [value, setValue] = useState(() => read(clock()));
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setValue(read(clock()));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock]);
  return value;
}

/** The app as the whole window. */
export const full = (base: Base): AppBox => ({ x: 0, y: 0, w: base.w, h: base.h, window: base.w, bar: TITLEBAR / 2 });

export interface Fit {
  scale: number;
  base: Base;
}

/** The tab size and scale that fit the box `area` gives. */
export function useFit(area: React.RefObject<HTMLDivElement | null>) {
  const [fit, setFit] = useState<Fit | null>(null);
  useLayoutEffect(() => {
    const node = area.current;
    if (!node) return;
    const measure = () => {
      const { clientWidth: w, clientHeight: h } = node;
      if (w < NARROW) {
        const scale = w / PHONE;
        setFit({ scale, base: { w: PHONE, h: Math.round(h / scale), phone: true, radius: RADIUS / scale } });
        return;
      }
      const fits = Math.min(w / DESK.w, h / DESK.h);
      const scale = fits >= LEGIBLE ? fits : Math.max(fits, Math.min(LEGIBLE, w / SMALLEST.w, h / SMALLEST.h));
      setFit({
        scale,
        base: {
          w: Math.min(DESK.w, Math.floor(w / scale)),
          h: Math.min(DESK.h, Math.floor(h / scale)),
          phone: false,
          radius: RADIUS / scale,
        },
      });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [area]);
  return fit;
}
