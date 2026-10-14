"use client";

import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { iconName, loaded, localIconUrl, missing } from "@/lib/icons";

function first(src: string) {
  return !src || missing.has(src) ? "broken" : loaded.has(src) ? "instant" : "loading";
}

/**
 * Node/tool icons come from `icons.zip` through the `hicon` protocol. An icon
 * already loaded once shows on the first paint; `warmRows` loads the sidebar's
 * next rows while their page is read. A new one stays hidden until it
 * loads: Chromium draws its broken-image glyph for a missing icon a frame or
 * more before the error event, so a visible new icon flashed that glyph. A slow
 * image shows a delayed skeleton, then fades over it. An icon the zip does not
 * hold renders the caller's fallback, and is never asked for again.
 *
 * Intrinsic size means nothing here: many SideFX icons carry a `viewBox` and no
 * `width`, so the webview reports a natural size of 0. Only a load error marks
 * an icon broken.
 */
export default function DocIconClient({
  src: source,
  alt,
  className = "doc-icon mr-2",
  priority = false,
  width = 1,
  height = 1,
  fallback = null,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  /** Drawn in place of an icon the install does not ship. A list gives the
      page glyph here, so a row whose icon is missing keeps its column; prose
      gives nothing, where a box the size of an icon would be a hole. */
  fallback?: React.ReactNode;
} & { width?: number; height?: number }) {
  const src = iconName(source);
  const [state, setState] = useState<"loading" | "skeleton" | "instant" | "loaded" | "broken">(() => first(src));
  // The page title and a recycled list row keep this mounted while `src`
  // changes. The new icon starts over like a new mount: the old picture kept
  // in place was the wrong icon beside the new label, and the broken-image
  // glyph when the new one was missing.
  const [shown, setShown] = useState(src);
  if (shown !== src) {
    setShown(src);
    setState(first(src));
  }

  useEffect(() => {
    if (state !== "loading") return;
    const timeout = window.setTimeout(() => setState("skeleton"), 150);
    return () => window.clearTimeout(timeout);
  }, [state, src]);

  // A missing icon draws what the caller says stands in for it, and nothing
  // when the caller says nothing.
  if (state === "broken") return <>{fallback}</>;

  return (
    <span
      className={`relative inline-grid ${className}`}
      data-doc-icon=""
      data-image-state={state}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {state === "skeleton" && (
        <span
          className="col-start-1 row-start-1 size-full animate-pulse rounded bg-muted"
          aria-hidden="true"
        />
      )}
      <img
        src={localIconUrl(src)}
        alt={alt}
        width={width}
        height={height}
        className="col-start-1 row-start-1 size-full object-contain"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        // An icon on screen now paints with its row: an async decode draws the
        // row first and the icon a frame later, even from the cache. An icon
        // this session has already drawn is in that cache, so it decodes with
        // the row too — the back button drew a row of blank marks otherwise.
        decoding={priority || state === "instant" ? "sync" : "async"}
        style={{
          opacity: state === "loading" || state === "skeleton" ? 0 : 1,
          transition: state === "skeleton" || state === "loaded" ? "opacity 200ms" : undefined,
        }}
        // Committed in the event itself, so the icon shows in the next frame.
        onLoad={(event) => {
          loaded.set(src, event.currentTarget);
          flushSync(() => setState((current) => (current === "skeleton" ? "loaded" : "instant")));
        }}
        onError={() => {
          missing.add(src);
          setState("broken");
        }}
      />
    </span>
  );
}
