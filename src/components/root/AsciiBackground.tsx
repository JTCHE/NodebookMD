"use client";

import { reducedMotion } from "@/lib/ui/motion";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { buildAsciiField } from "@/lib/landing/asciiField";

/* The field is a pure function of (column, row, phase), built once at module
   scope for phase 0 so the server and the first client paint are byte-
   identical: no client cost, no layout work, before hydration. Its grid is
   sized for a generous default box; the client measures its real box on
   mount and rebuilds to fit exactly, so it never letterboxes on screens
   bigger (or smaller) than that default. */
const STATIC_FIELD = buildAsciiField(0);

/* Artistic controls. TICK_INTERVAL_MS is the frame rate (lower = smoother,
   costlier); PHASE_STEP is the drift per frame (higher = faster wave). Ten
   ticks a second at this step is a slow, subtle crawl and cheap enough that
   a mid-range phone never notices it. Each tick rebuilds the field and
   writes it straight to the node via a ref, so it never triggers a React
   re-render. */
const TICK_INTERVAL_MS = 100;
const PHASE_STEP = 0.05;

/* One extra column and row of slack past the measured box, so rounding never
   leaves a sliver of the container uncovered at the centred field's edge. */
const GRID_SLACK = 2;

function measureCellSizePx(fieldNode: HTMLElement): { width: number; height: number } {
  const probe = document.createElement("span");
  probe.textContent = "×";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  fieldNode.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  const height = parseFloat(getComputedStyle(fieldNode).lineHeight);
  fieldNode.removeChild(probe);
  return { width, height };
}

function computeGrid(containerNode: HTMLElement, fieldNode: HTMLElement) {
  const cell = measureCellSizePx(fieldNode);
  if (cell.width <= 0 || cell.height <= 0) return null;
  return {
    columnCount: Math.ceil(containerNode.clientWidth / cell.width) + GRID_SLACK,
    rowCount: Math.ceil(containerNode.clientHeight / cell.height) + GRID_SLACK,
  };
}

/**
 * `glow` is the soft centre the field is read through on a full-bleed page.
 * A field confined to one corner of the window does not need it — nothing is
 * read on top of it — and the glow would show as a bright patch in that
 * corner, so the corner variant turns it off.
 */
export function AsciiBackground({ className, glow = true }: { className?: string; glow?: boolean }) {
  const fieldRef = useRef<HTMLPreElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const fieldNode = fieldRef.current;
    const containerNode = containerRef.current;
    if (!fieldNode || !containerNode) return;

    let phase = 0;
    let grid = computeGrid(containerNode, fieldNode);
    if (grid) fieldNode.textContent = buildAsciiField(phase, grid.columnCount, grid.rowCount);

    const resizeObserver = new ResizeObserver(() => {
      const nextGrid = computeGrid(containerNode, fieldNode);
      if (!nextGrid) return;
      grid = nextGrid;
      fieldNode.textContent = buildAsciiField(phase, grid.columnCount, grid.rowCount);
    });
    resizeObserver.observe(containerNode);

    if (reducedMotion()) return () => resizeObserver.disconnect();

    let isVisible = true;
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    });
    intersectionObserver.observe(containerNode);

    let lastTick = 0;
    let frameId: number;

    const tick = (timestamp: number) => {
      frameId = requestAnimationFrame(tick);
      if (document.hidden || !isVisible) return;
      if (timestamp - lastTick < TICK_INTERVAL_MS) return;
      lastTick = timestamp;
      phase += PHASE_STEP;
      if (grid) fieldNode.textContent = buildAsciiField(phase, grid.columnCount, grid.rowCount);
    };
    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 select-none overflow-hidden", className)}
    >
      {/* Brand orange on a light page reads as a warm watermark. On a dark one
          the same orange is the only chroma on the screen and pulls the eye off
          the hero, so the field drops to plain grey there. */}
      <pre
        ref={fieldRef}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-meta leading-relaxed text-foreground/10 dark:text-neutral-500/10"
      >
        {STATIC_FIELD}
      </pre>
      {/* The soft centre glow. It sits over the field and under the content, so
          the hero column stays readable against the pattern. */}
          {/* To do: fix strong banding. Look at obsidian spec for image */}
      {glow && (
        <div className="absolute top-1/2 left-1/2 h-2/5 max-w-page w-full scale-110 -translate-x-1/2 -translate-y-1/2 bg-background/90 blur-3xl" />
      )}
    </div>
  );
}
