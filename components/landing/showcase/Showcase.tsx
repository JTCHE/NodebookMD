"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Controls } from "@/components/landing/showcase/Controls";
import { KeyCue, Opened } from "@/components/landing/showcase/Cues";
import { Cursor, type Place } from "@/components/landing/showcase/Cursor";
import { pane } from "@/components/landing/showcase/F1Demo";
import { useFrameStyle } from "@/components/landing/showcase/frameStyle";
import { MIN_AREA, RADIUS, useFit } from "@/components/landing/showcase/layout";
import { START } from "@/components/landing/showcase/scenes";
import { TABS } from "@/components/landing/showcase/tabs";
import { useTour } from "@/components/landing/showcase/useTour";
import { cn } from "@/lib/utils";

/** The window's shadow in the Figma mockup, on its 1440px window. It scales
    with the frame, so a smaller frame keeps the same look. */
const MOCKUP_WIDTH = 1440;
const shadow = (width: number) => {
  const k = width / MOCKUP_WIDTH;
  return `0 ${75 * k}px ${208 * k}px rgba(0,0,0,0.4), 0 0 ${6.25 * k}px rgba(0,0,0,0.25)`;
};

/** The real app in a frame, driven through a tour of what it does. */
export function Showcase() {
  const area = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const place = useRef<Place>({ x: 0, y: 0, k: 1 });
  const fit = useFit(area);
  const [ready, setReady] = useState(false);
  // WebKit takes `zoom` into the frame's document twice, and the app fills
  // part of its box. There, the tab scales by a transform instead. Safari on
  // a phone gives no size that shows it, so it is known by its gesture
  // events, which only WebKit has; any other WebKit, by the sizes, below.
  const [twice, setTwice] = useState(() => typeof window !== "undefined" && "GestureEvent" in window);
  // The tour starts once the frame has come in and looks flat: at 60% of its
  // spring it is within half a degree of flat. The spring's tail is too
  // small to see, and waiting for it delays the start by 0.6 s. With less
  // motion it does not come in: it is there.
  const [settled, setSettled] = useState(
    () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const tour = useTour({ frame, cursor, place, ready: ready && settled });
  const { tab } = tour;

  // Between two tabs that both show the app, the app moves to its new place.
  // Into or out of a tab without it, the frame cuts.
  const [shown, setShown] = useState(tour.active);
  const [moves, setMoves] = useState(false);
  if (shown !== tour.active) {
    setShown(tour.active);
    setMoves(!!tab.app && !!TABS[shown].app);
  }

  useFrameStyle(frame, ready, { pane: tab.app === pane, phone: !!fit?.base.phone });

  const Demo = tab.demo;
  const base = fit?.base;
  const scale = fit?.scale ?? 0;
  const app = base && tab.app?.(base);
  const whole = !!base && !!app && app.w === base.w && app.h === base.h;
  // The app's place in the frame, for the cursor, which lives outside the zoom.
  useLayoutEffect(() => {
    if (app) place.current = { x: app.x * scale, y: app.y * scale, k: (scale * app.w) / app.window };
  });
  const motion = moves ? "duration-500 ease-[cubic-bezier(0.3,0.7,0.2,1)]" : "duration-0";

  return (
    <div className="flex w-full flex-1 flex-col items-center gap-lg">
      <div
        ref={area}
        // A screen too short for the header and the app scrolls, rather than
        // draw the app as a strip.
        style={{ minHeight: MIN_AREA }}
        className="relative grid min-h-0 w-full flex-1 place-items-center"
      >
        {base && (
          <div
            // Out of the flow and centred by its margins, not a transform: the
            // area then sizes by the page alone, never by the frame in it.
            className="enter-tilt absolute inset-0 m-auto"
            onAnimationStart={(event) => {
              if (event.target !== event.currentTarget) return;
              const ms = Number(event.currentTarget.getAnimations()[0]?.effect?.getComputedTiming().duration ?? 0);
              setTimeout(() => setSettled(true), ms * 0.6);
            }}
            style={{ width: base.w * scale, height: base.h * scale, "--enter": 5 } as React.CSSProperties}
          >
            <div
              className="rim absolute inset-0 overflow-hidden bg-background"
              style={{ borderRadius: RADIUS, boxShadow: shadow(base.w * scale) }}
              onPointerDown={() => !tab.scene && tour.take()}
              // A touch leaves at its lift, so only a pointer that hovers counts.
              onPointerLeave={(event) => event.pointerType !== "touch" && tour.leave(true)}
              onPointerEnter={(event) => event.pointerType !== "touch" && tour.leave(false)}
            >
              <div
                className="absolute top-0 left-0"
                // Zoom, not a transform: the app then lays out at the size it
                // is drawn, so its 1px lines land on whole device pixels.
                style={{
                  width: base.w,
                  height: base.h,
                  ...(twice ? { transform: `scale(${scale})`, transformOrigin: "0 0" } : { zoom: scale }),
                }}
              >
                {Demo && (
                  <div
                    key={`${tab.id}-${tour.run}`}
                    className="absolute inset-0"
                  >
                    <Demo
                      go={tour.go}
                      clock={tour.clock}
                      base={base}
                    />
                  </div>
                )}
                <div
                  className={cn(
                    "absolute overflow-hidden transition-[left,top,width,height,border-radius]",
                    motion,
                    !app && "pointer-events-none invisible",
                  )}
                  style={
                    app
                      ? { left: app.x, top: app.y, width: app.w, height: app.h, borderRadius: whole ? 0 : app.corners }
                      : { left: 0, top: 0, width: base.w, height: base.h }
                  }
                >
                  <div
                    className={cn("absolute top-0 left-0 origin-top-left transition-[scale,width,height]", motion)}
                    style={{
                      width: app?.window ?? base.w,
                      // A slide that shrinks the app to nothing has no ratio to keep.
                      height: app?.w ? (app.h * app.window) / app.w : base.h,
                      scale: String(app ? app.w / app.window : 1),
                    }}
                  >
                    <iframe
                      ref={frame}
                      src="/demo/app/index.html"
                      title="The app, running on sample pages written for this site"
                      className={cn("size-full border-0 bg-background transition-opacity duration-300", !ready && "opacity-0")}
                      onLoad={() => {
                        const doc = frame.current?.contentDocument;
                        // The app has drawn once its shell holds something; a narrow
                        // window has no sidebar, so nothing more particular.
                        const look = () => {
                          const win = doc?.defaultView;
                          if (!win || !doc.querySelector("#root main, #root input")) return setTimeout(look, 50);
                          // Looked for at every resize, not once: a phone can
                          // take the zoom in after the app has drawn.
                          const check = () => doc.documentElement.clientWidth < win.innerWidth - 1 && setTwice(true);
                          check();
                          new win.ResizeObserver(check).observe(doc.documentElement);
                          win.addEventListener("resize", check);
                          tour.go(`/${START.path}`);
                          // Shown once the page is drawn, not its home screen; after
                          // 2s, whatever the app shows.
                          const drawn = (tries: number) =>
                            doc.querySelector("article h1") || !tries ? setReady(true) : setTimeout(drawn, 50, tries - 1);
                          drawn(40);
                        };
                        look();
                      }}
                    />
                  </div>
                </div>
              </div>

              <Cursor ref={cursor} />
              <KeyCue keys={tour.key} />
            </div>
            {tour.opened && app && (
              <div
                className={cn(
                  "pointer-events-none absolute z-10 -translate-y-1/2",
                  app.end ? "-translate-x-full" : "-translate-x-1/2",
                )}
                style={{ left: (app.end ? app.x + app.w - 8 : app.x + app.w / 2) * scale, top: app.bar * scale }}
              >
                <Opened
                  key={tour.opened.at}
                  title={base.phone ? null : tour.opened.title}
                  ms={tour.opened.ms}
                  size={Math.max(10.5, 13 * scale * (app.w / app.window))}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <Controls
        active={tour.active}
        paused={tour.paused}
        progress={tour.progress}
        onPick={tour.pick}
        onToggle={tour.toggle}
      />
    </div>
  );
}
