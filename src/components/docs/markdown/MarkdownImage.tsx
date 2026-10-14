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

/** The address, and the size the Rust side read from the file and wrote
    after it: `#640x480`, or `#640:480` for an SVG that has a ratio and no
    width of its own. See `image_src` in the parser's `markdown.rs`. */
function written(src: string): { path: string; size: Omit<Seen, "ground"> | null } {
  const [path, mark = ""] = src.split("#");
  const size = /^(\d+)([x:])(\d+)$/.exec(mark);
  if (!size) return { path, size: null };
  return { path, size: { natural: size[2] === "x" ? Number(size[1]) : 0, ratio: `${size[1]} / ${size[3]}` } };
}

/** A figure on a help page. The Rust side resolved the path against the page,
    so this only has to build the URL. An inline `[Icon:TOOLS/handles]` arrives
    here too, as an `<img data-icon>` with no `src` — see `icon` in the
    parser's `markdown.rs` — and `DocIconClient` draws it from `icons.zip`. */
export const Image: Components["img"] = function MarkdownImage({ src, alt, ...props }) {
  const { path, size } = written(typeof src === "string" ? src : "");
  const url = path ? assetUrl(path) : "";
  // A picture holds its room from the first frame: the page wrote its size.
  // One seen before also has its ground, so it draws final at once. A new
  // one stays clear until it has loaded and been read, then fades in.
  const [known, setKnown] = useState<Seen | null>(() => seen.get(url) ?? null);
  const ground = known?.ground ?? null;
  const natural = known?.natural ?? size?.natural ?? 0;
  const ratio = known?.ratio ?? size?.ratio;
  const data = props as Record<string, unknown>;
  if (typeof data["data-icon"] === "string") {
    return (
      <DocIconClient
        src={data["data-icon"]}
        alt={alt ?? ""}
        className={`doc-icon inline-icon-${String(data["data-size"] ?? "normal")} mx-0.5`}
      />
    );
  }
  if (!src || typeof src !== "string") return null;
  // A drawing small enough to be a glyph stays a glyph.
  const vector = /\.svg$/i.test(path) && (natural === 0 || natural >= 120);
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
      style={{ ...(width && { "--natural": width }), ...(ratio && { aspectRatio: ratio }) } as React.CSSProperties}
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
          // An SVG with only a viewBox reports 0 by 0: the page's ratio, if any.
          ratio: image.naturalHeight ? `${image.naturalWidth} / ${image.naturalHeight}` : (size?.ratio ?? "auto"),
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
