import { useState } from "react";
import { flushSync } from "react-dom";
import type { Components } from "react-markdown";
import { assetUrl } from "@/lib/assets";
import { openLightbox } from "@/lib/lightbox";
import { groundClass, groundFor, type Ground } from "@/lib/ground";
import DocIconClient from "./DocIconClient";

/** What a picture turned out to be, by URL, for the next time it is drawn. */
interface Seen {
  natural: number;
  ratio: string;
  ground: Ground | null;
}
const seen = new Map<string, Seen>();

/** A figure on a help page. The Rust side resolved the path against the page,
    so this only has to build the URL. An inline `[Icon:TOOLS/handles]` arrives
    here too, as an `<img data-icon>` with no `src` — see `icon` in the
    parser's `markdown.rs` — and `DocIconClient` draws it from `icons.zip`. */
export const Image: Components["img"] = function MarkdownImage({ src, alt, ...props }) {
  const url = typeof src === "string" ? assetUrl(src) : "";
  // A picture seen before starts as it ended: its size and its ground from
  // the first frame, so it never draws twice. A new one stays clear until it
  // has loaded and been read; it then draws once, final, and fades in.
  const [known, setKnown] = useState<Seen | null>(() => seen.get(url) ?? null);
  const ground = known?.ground ?? null;
  const natural = known?.natural ?? 0;
  const data = props as Record<string, unknown>;
  if (typeof data["data-icon"] === "string") {
    return (
      <DocIconClient
        src={`${data["data-icon"]}.svg`}
        alt={alt ?? ""}
        className={`doc-icon inline-icon-${String(data["data-size"] ?? "normal")} mx-0.5`}
      />
    );
  }
  if (!src || typeof src !== "string") return null;
  // A drawing small enough to be a glyph stays a glyph.
  const vector = /\.svg$/i.test(src) && (natural === 0 || natural >= 120);
  const width = vector ? "100vw" : natural ? `${natural}px` : "";
  return (
    <img
      src={url}
      alt={alt ?? ""}
      // A raster keeps its own size: drawn larger than its file it only
      // turns soft. A drawing (SVG) is sharp at any size, and SideFX draws
      // its diagrams small, so it takes the full width. The stylesheet does
      // the rest from `--natural` (`img.markdown-media`): a picture as wide
      // as the text hangs into the gutter as a video does.
      // The ground behind a clear picture is chosen from its own marks: see
      // lib/ground. The lightbox reads it off `data-ground`.
      className={`markdown-media my-4 block h-auto cursor-zoom-in transition-opacity duration-(--duration-fast) motion-reduce:transition-none ${
        known ? groundClass(ground) : "opacity-0"
      }`}
      style={{ ...(width && { "--natural": width }), ...(known && { aspectRatio: known.ratio }) } as React.CSSProperties}
      data-ground={ground ?? undefined}
      // The ground is read from the pixels, and the app serves pictures from
      // another origin (`himage:`), which answers with CORS for this.
      crossOrigin="anonymous"
      onClick={(event) => openLightbox(event.currentTarget)}
      // `loading="lazy"` never fires in this app: every doc page scrolls
      // inside its own `overflow-y-auto` shell, not the window, and Chromium's
      // native lazy loader watches the window's viewport only — an image two
      // screens down never crosses its threshold and never loads. Eager is
      // the honest choice, not a stopgap: a doc page carries at most a few
      // dozen pictures, nothing like an endless feed.
      decoding="async"
      onLoad={(event) => {
        const image = event.currentTarget;
        const next = {
          natural: image.naturalWidth,
          // An SVG with only a viewBox reports 0 by 0: no ratio to keep.
          ratio: image.naturalHeight ? `${image.naturalWidth} / ${image.naturalHeight}` : "auto",
          ground: groundFor(image),
        };
        seen.set(url, next);
        // Now, inside the load event, so the frame that first shows the
        // picture already has its size and its ground.
        flushSync(() => setKnown(next));
      }}
    />
  );
};
