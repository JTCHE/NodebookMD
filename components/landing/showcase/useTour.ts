"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cursorPointer, type Place } from "@/components/landing/showcase/Cursor";
import { Driver, Stopped, timeOpen, type Cues } from "@/components/landing/showcase/driver";
import { TABS } from "@/components/landing/showcase/tabs";

export interface OpenedPage {
  title: string;
  ms: number;
  /** When it opened: a new page redraws the chip. */
  at: number;
}

const quiet = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The tour through the tabs: which tab shows, its scene in the app, its
 * clock, and the reader's hand on all of it.
 *
 * - A pointer over the frame changes nothing: the tour plays on. The play
 *   button pauses it: that stops the tab's clock, the scene and the cursor,
 *   and hides the cursor.
 * - The reader's own input in the app holds the scene where it is, as the
 *   button does. When their pointer leaves the frame, or they press play, the
 *   app goes back to the page the scene was on, and the tour plays on.
 * - Every resume goes back a second: a demo on the clock plays that second
 *   again, and a scene waits it out while its gauge catches up.
 * - A tab the reader picks plays from its start.
 */
export function useTour({
  frame,
  cursor,
  place,
  ready,
}: {
  frame: React.RefObject<HTMLIFrameElement | null>;
  cursor: React.RefObject<HTMLDivElement | null>;
  place: React.RefObject<Place>;
  ready: boolean;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  /** Bumped to run the tab's scene again from its start. */
  const [run, setRun] = useState(0);
  /** The reader took the app over: the page to go back to, and whether their
      pointer leaving resumes the tour. It does not after a pause from the
      button. */
  const reader = useRef<{ path: string; leave: boolean } | null>(null);
  /** Until when a resumed scene waits, while its gauge plays the second again. */
  const lead = useRef(0);
  const release = useRef<(() => void) | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedPage | null>(null);
  /** The active tab's gauge, which the clock draws into. */
  const progress = useRef<HTMLSpanElement>(null);
  /** How long the tab run `turn` has played, in ms. The clock of a new tab reads
      0 until its effect starts it: a demo's own effects run before this
      hook's, and would read the last tab's time. */
  const played = useRef({ turn: "", ms: 0 });
  const turn = `${active}-${run}-${ready}`;
  const clock = useCallback(() => (played.current.turn === turn ? played.current.ms : 0), [turn]);

  const tab = TABS[active];
  // One hand for every tab, so a move a tab change cuts is still the one the
  // next move cancels.
  const hand = useMemo(() => cursorPointer(cursor, place), [cursor, place]);

  /** Moves the app to a page, as its own link would, and times it. */
  const go = useCallback(
    (path: string, title?: string) => {
      const win = frame.current?.contentWindow as (Window & typeof globalThis) | null | undefined;
      if (!win || win.location.pathname === path) return;
      const move = () => {
        const idx = ((win.history.state as { idx?: number } | null)?.idx ?? 0) + 1;
        win.history.pushState({ usr: null, key: Math.random().toString(36).slice(2, 10), idx }, "", path);
        win.dispatchEvent(new win.PopStateEvent("popstate", { state: win.history.state }));
      };
      if (!title) return move();
      void timeOpen(win, title, move).then((ms) => ms && setOpened({ title, ms, at: Date.now() }));
    },
    [frame],
  );

  const free = useCallback(() => {
    release.current?.();
    release.current = null;
  }, []);

  /** What a scene waits on between two steps. */
  const gate = useCallback(async () => {
    // Looks again after every wake: a wake is a hint, not a release. A hidden
    // page has no event to wake it, so the timer wakes it.
    for (let left; (left = lead.current - performance.now()) > 0 || pausedRef.current || document.hidden; ) {
      await new Promise<void>((done) => {
        release.current = done;
        setTimeout(done, Math.min(250, Math.max(left, 16)));
      });
    }
  }, []);

  const pick = useCallback((index: number) => {
    reader.current = null;
    lead.current = 0;
    setPaused(false);
    setActive(index);
    setRun((n) => n + 1);
  }, []);

  const resume = useCallback(() => {
    const path = reader.current?.path;
    reader.current = null;
    // ponytail: only the page comes back, not a search or a picture the reader
    // opened on it; a scene step that then finds nothing ends the tab.
    if (path) go(path);
    played.current.ms = Math.max(0, played.current.ms - 1000);
    lead.current = performance.now() + 1000;
    pausedRef.current = false;
    setPaused(false);
    free();
  }, [go, free]);

  const toggle = useCallback(() => {
    if (!pausedRef.current) return setPaused(true);
    resume();
  }, [resume]);

  /** The reader's own input in the app, or on a demo. */
  const take = useCallback(() => {
    const path = frame.current?.contentWindow?.location.pathname ?? "";
    reader.current ??= { path, leave: !pausedRef.current };
    setPaused(true);
  }, [frame]);

  const leave = useCallback(() => {
    if (reader.current?.leave) resume();
  }, [resume]);

  useEffect(() => hand.hold(paused), [paused, hand]);

  // "Connect your agent" and friends open a tab from outside.
  useEffect(() => {
    const open = (event: Event) => {
      const index = TABS.findIndex((t) => t.id === (event as CustomEvent<string>).detail);
      if (index >= 0) pick(index);
    };
    window.addEventListener("showcase", open);
    return () => window.removeEventListener("showcase", open);
  }, [pick]);

  // A reader who asks for less motion gets the tabs, paused.
  useEffect(() => {
    if (quiet()) setPaused(true);
  }, []);

  // Only a real event is the reader's; the driver's are not trusted.
  useEffect(() => {
    if (!ready) return;
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const takeOver = (event: Event) => event.isTrusted && take();
    const types = ["pointerdown", "keydown", "wheel"];
    for (const type of types) doc.addEventListener(type, takeOver, true);
    return () => {
      for (const type of types) doc.removeEventListener(type, takeOver, true);
    };
  }, [ready, frame, take]);

  // The tab's scene, its clock, and the move to the next tab.
  useEffect(() => {
    const controller = new AbortController();
    setKey(null);
    setOpened(null);

    const cues: Cues = {
      key: setKey,
      opened: (title, ms) => setOpened({ title, ms, at: Date.now() }),
    };

    // No clock before the tour starts: a gauge that fills while the frame
    // comes in would drop back to empty when it does.
    progress.current?.style.setProperty("--progress", "0");
    if (!ready) return () => controller.abort();

    // The clock runs while the tour is not paused. A scene ends its tab
    // itself; the clock is then only its gauge.
    played.current = { turn, ms: 0 };
    let last = performance.now();
    let frameId = 0;
    const tick = (now: number) => {
      if (!pausedRef.current && !document.hidden) played.current.ms += Math.max(0, now - last);
      last = now;
      progress.current?.style.setProperty("--progress", String(Math.min(1, played.current.ms / tab.ms)));
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    const next = () => {
      if (!controller.signal.aborted && !pausedRef.current) setActive((index) => (index + 1) % TABS.length);
    };

    let timer = 0;
    const play = tab.scene;
    const driver = frame.current && ready ? new Driver(frame.current, hand, cues, controller.signal, gate) : null;
    // A reader, or a scene cut short, may have left a picture or the search
    // open: every tab closes it first.
    const closed = driver?.key("Escape") ?? Promise.resolve();
    if (play && driver && !quiet()) {
      closed
        .then(() => play(driver))
        .catch((error) => {
          if (!(error instanceof Stopped)) console.error(error);
        })
        .finally(() => {
          hand.show(false);
          if (controller.signal.aborted) return;
          const wait = () => (timer = window.setTimeout(pausedRef.current ? wait : next, pausedRef.current ? 200 : 400));
          wait();
        });
    } else if (!play) {
      closed.catch(() => {});
      const wait = () => {
        if (controller.signal.aborted) return;
        if (played.current.ms >= tab.ms) next();
        else timer = window.setTimeout(wait, 100);
      };
      wait();
    }

    return () => {
      controller.abort();
      cancelAnimationFrame(frameId);
      clearTimeout(timer);
      hand.show(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready, run]);

  return { active, tab, paused, run, key, opened, progress, clock, go, pick, toggle, take, leave };
}
