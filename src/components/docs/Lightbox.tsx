import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { closeLightbox, useLightbox, type LightboxState } from "@/lib/lightbox";
import { groundClass } from "@/lib/ground";
import { Hint } from "@/components/ui/Hint";
import { iconFileEntries } from "@/components/shell/ContextMenu";
import { COMMAND_KEY, isCommand, letterOf } from "@/lib/hotkeys";

const MAX_SCALE = 8;
/** One wheel notch, one key press: the same step either way. */
const STEP = 1.2;
const CLICK_SCALE = 2.5;
/** A press that moves further than this is a pan, not a click. */
const CLICK_SLOP = 4;
/** A small figure is drawn larger to fill the stage, but no more than this:
    past it a raster diagram turns to mush. */
const MAX_UPSCALE = 2;
/** How much of the stage an icon fills: big enough to read every line, with
    a margin, so it does not read as a picture cropped to its edges. */
const ICON_ROOM = 0.6;
const MOTION = { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" };

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ROUND_BUTTON =
  "grid size-[36px] cursor-interactive place-items-center rounded-full bg-white/10 text-white/80 " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:bg-white/20 pointer-hover:text-white " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/**
 * A page's pictures, one at a time, over the window.
 *
 * It grows out of the picture that was pressed and shrinks back into it. The
 * wheel zooms at the pointer, a drag pans a zoomed picture, a click zooms
 * in or back out, and the arrows walk the page's pictures. Escape, the
 * close button or a press on the dark ground puts it away.
 *
 * The title bar stays uncovered, so the window's own buttons still work: the
 * dialog clips a zoomed picture to its own box, below the title bar.
 */
export function Lightbox() {
  const open = useLightbox();
  if (!open) return null;
  return createPortal(<Viewer key={open.items.map((item) => item.src).join()} open={open} />, document.body);
}

function Viewer({ open }: { open: LightboxState }) {
  const [index, setIndex] = useState(open.index);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // The wheel listener is attached once and reads the scale of the moment.
  const scaleNow = useRef(view.scale);
  scaleNow.current = view.scale;

  const item = open.items[index];
  const count = open.items.length;
  const zoomed = view.scale > 1;

  /** Keeps a zoomed picture over the stage: it can be pushed to its own
      edge and no further. */
  const clamp = useCallback((scale: number, x: number, y: number) => {
    const img = picture.current;
    const box = stage.current;
    if (!img || !box) return { scale, x, y };
    const roomX = Math.max(0, (img.offsetWidth * scale - box.clientWidth) / 2);
    const roomY = Math.max(0, (img.offsetHeight * scale - box.clientHeight) / 2);
    return { scale, x: Math.min(roomX, Math.max(-roomX, x)), y: Math.min(roomY, Math.max(-roomY, y)) };
  }, []);

  /** Zoom to `next`, keeping the point under (`clientX`, `clientY`) still. */
  const zoomAt = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const box = stage.current;
      if (!box) return;
      const bounds = box.getBoundingClientRect();
      const pointX = clientX - (bounds.left + bounds.width / 2);
      const pointY = clientY - (bounds.top + bounds.height / 2);
      setView((current) => {
        const scale = Math.min(MAX_SCALE, Math.max(1, next));
        if (scale === 1) return { scale: 1, x: 0, y: 0 };
        const ratio = scale / current.scale;
        return clamp(scale, pointX - (pointX - current.x) * ratio, pointY - (pointY - current.y) * ratio);
      });
    },
    [clamp],
  );

  const zoomCentre = useCallback(
    (next: number) => {
      const bounds = stage.current?.getBoundingClientRect();
      if (bounds) zoomAt(next, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    },
    [zoomAt],
  );

  const show = useCallback((next: number) => {
    setIndex(next);
    setView({ scale: 1, x: 0, y: 0 });
    setSize(null);
  }, []);

  const go = useCallback(
    (step: number) => {
      if (count > 1) show((index + step + count) % count);
    },
    [count, index, show],
  );

  /** The rectangle to grow from or shrink into: the pressed picture, when
      it is the one on screen and still on the page. */
  const source = useCallback(() => {
    const from = open.from;
    if (!from?.isConnected || index !== open.index) return null;
    const rect = from.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }, [open, index]);

  /** The transform that lays the frame over `rect`. */
  const over = (rect: DOMRect) => {
    const target = frame.current!.getBoundingClientRect();
    const scale = rect.width / target.width;
    const x = rect.left + rect.width / 2 - (target.left + target.width / 2);
    const y = rect.top + rect.height / 2 - (target.top + target.height / 2);
    return `translate(${x}px, ${y}px) scale(${scale})`;
  };

  const close = useCallback(() => {
    if (closing) return;
    setClosing(true);
    const done = () => {
      closeLightbox();
      open.from?.focus?.({ preventScroll: true });
    };
    const rect = source();
    if (reducedMotion() || !frame.current) return done();
    root.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...MOTION, fill: "forwards" });
    const shrink = rect
      ? frame.current.animate([{ transform: "none" }, { transform: over(rect) }], { ...MOTION, fill: "forwards" })
      : frame.current.animate([{ opacity: 1 }, { opacity: 0 }], { ...MOTION, fill: "forwards" });
    shrink.onfinish = done;
    // `over` reads the frame, so it is defined inside the render; the
    // callback only ever runs against the current one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, source, open]);

  useLayoutEffect(() => {
    root.current?.focus({ preventScroll: true });
    if (!reducedMotion()) root.current?.animate([{ opacity: 0 }, { opacity: 1 }], MOTION);
  }, []);

  // Grow out of the pressed picture, once the picture has its size, and
  // before that size is painted: the reader never sees it land first.
  const grown = useRef(false);
  useLayoutEffect(() => {
    if (grown.current || !size) return;
    grown.current = true;
    const rect = source();
    if (rect && frame.current && !reducedMotion()) {
      frame.current.animate([{ transform: over(rect) }, { transform: "none" }], MOTION);
    }
    // Once, when the first size lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // The wheel has to be a listener that is not passive, or the window
  // scrolls behind the picture instead of zooming it.
  useEffect(() => {
    const box = root.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = scaleNow.current;
      zoomAt(event.deltaY < 0 ? scale * STEP : scale / STEP, event.clientX, event.clientY);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /** The picture's size at scale 1: as large as the stage allows, up to
      MAX_UPSCALE times its own. */
  const fit = useCallback(() => {
    const img = picture.current;
    const box = stage.current;
    if (!img?.naturalWidth || !box) return;
    // An icon is drawn in lines, not pixels: it grows to most of the stage
    // with no blur, where a picture stops before its pixels show.
    const icon = img.dataset.icon !== undefined;
    const room = icon ? ICON_ROOM : 1;
    const ratio = Math.min(
      (box.clientWidth * room) / img.naturalWidth,
      (box.clientHeight * room) / img.naturalHeight,
      icon ? Infinity : MAX_UPSCALE,
    );
    setSize({ width: Math.round(img.naturalWidth * ratio), height: Math.round(img.naturalHeight * ratio) });
  }, []);

  useLayoutEffect(() => {
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit, index]);

  // On the window, not the dialog: the keys work wherever the focus went.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  onKey.current = (event) => {
    // The page's own shortcuts act on a page the reader cannot see. Over an
    // icon, Ctrl+C and Ctrl+S copy and save the icon instead.
    if (isCommand(event) && !event.shiftKey && "cdls".includes(letterOf(event) || "-")) {
      event.preventDefault();
      event.stopPropagation();
      const keys = `${COMMAND_KEY}+${letterOf(event).toUpperCase()}`;
      if (item?.icon) iconFileEntries(item.icon, true).find((entry) => entry.keys === keys)?.run();
      return;
    }
    const keys: Record<string, () => void> = {
      Escape: close,
      ArrowLeft: () => go(-1),
      ArrowRight: () => go(1),
      "+": () => zoomCentre(view.scale * STEP),
      "=": () => zoomCentre(view.scale * STEP),
      "-": () => zoomCentre(view.scale / STEP),
      "0": () => setView({ scale: 1, x: 0, y: 0 }),
    };
    const run = keys[event.key];
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    run();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  function onPointerDown(event: React.PointerEvent) {
    if (event.button !== 0) return;
    moved.current = false;
    if (!zoomed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: view.x, y: view.y, startX: event.clientX, startY: event.clientY };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent) {
    const held = drag.current;
    if (!held) return;
    if (Math.hypot(event.clientX - held.startX, event.clientY - held.startY) > CLICK_SLOP) moved.current = true;
    setView(clamp(view.scale, held.x + event.clientX - held.startX, held.y + event.clientY - held.startY));
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  if (!item) return null;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      data-lightbox
      aria-label={item.alt || "Picture"}
      tabIndex={-1}
      className="fixed inset-x-0 top-titlebar bottom-0 z-[70] overflow-hidden outline-none select-none"
    >
      {/* The ground. A press on it, and not a drag that ends on it, closes. */}
      <div className="absolute inset-0 bg-black/95" onClick={close} />
      {/* The title bar goes dark with the page, as it does under every modal;
          a light bar over the dark ground read as a second window. */}
      <div className="fixed inset-x-0 top-0 h-titlebar bg-black/95" onClick={close} />

      {/* What the picture is, and where it sits among the page's. Out of the
          way while the reader is looking closely. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[52px] items-center justify-center gap-sm px-[96px]",
          "text-meta text-white/70 transition-opacity duration-(--duration-fast) motion-reduce:transition-none",
          zoomed && "opacity-0",
        )}
      >
        {item.alt && <span className="truncate">{item.alt}</span>}
        {count > 1 && (
          <span className="shrink-0 tabular-nums text-white/45">
            {index + 1} / {count}
          </span>
        )}
      </div>

      <Hint label="Close" keys="Esc" className="absolute top-sm right-sm z-10">
        <button type="button" aria-label="Close" className={ROUND_BUTTON} onClick={close}>
          <Icons.dismiss className="size-[18px]" />
        </button>
      </Hint>

      <div
        ref={stage}
        className={cn(
          "pointer-events-none absolute inset-x-[64px] top-[52px] flex items-center justify-center",
          count > 1 ? "bottom-[88px]" : "bottom-lg",
        )}
      >
        <div ref={frame} className="flex max-h-full max-w-full items-center justify-center">
          <img
            ref={picture}
            src={item.src}
            alt={item.alt}
            draggable={false}
            crossOrigin="anonymous"
            data-icon={item.icon}
            onLoad={fit}
            width={size?.width}
            height={size?.height}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onClick={(event) => {
              if (moved.current) return;
              if (zoomed) setView({ scale: 1, x: 0, y: 0 });
              else zoomAt(CLICK_SCALE, event.clientX, event.clientY);
            }}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            className={cn(
              // The same ground the page gave the picture.
              "pointer-events-auto object-contain",
              groundClass(item.ground),
              zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in",
              !dragging && "transition-transform duration-(--duration-fast) ease-out motion-reduce:transition-none",
            )}
          />
        </div>
      </div>

      {count > 1 && (
        <>
          <Strip items={open.items} index={index} hidden={zoomed} onPick={show} />
          <Hint label="Previous" keys="←" className="absolute top-1/2 left-sm -translate-y-1/2">
            <button type="button" aria-label="Previous picture" className={ROUND_BUTTON} onClick={() => go(-1)}>
              <Icons.stepBack className="size-[18px]" />
            </button>
          </Hint>
          <Hint label="Next" keys="→" className="absolute top-1/2 right-sm -translate-y-1/2">
            <button type="button" aria-label="Next picture" className={ROUND_BUTTON} onClick={() => go(1)}>
              <Icons.stepForward className="size-[18px]" />
            </button>
          </Hint>
        </>
      )}
    </div>
  );
}

/** Every picture of the page, small, under the stage: a press goes straight
    to one. Out of the way while the reader looks closely, like the caption. */
function Strip({
  items,
  index,
  hidden,
  onPick,
}: {
  items: LightboxState["items"];
  index: number;
  hidden: boolean;
  onPick: (index: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // The current one stays in view when the arrows walk past the edge.
  useEffect(() => {
    strip.current?.children[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [index]);
  return (
    <div
      ref={strip}
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 mx-auto flex w-fit max-w-full gap-xs overflow-x-auto px-lg py-md [scrollbar-width:none]",
        "transition-opacity duration-(--duration-fast) motion-reduce:transition-none",
        hidden && "pointer-events-none opacity-0",
      )}
    >
      {items.map((item, at) => (
        <button
          key={item.src}
          type="button"
          aria-label={item.alt ? `Show ${item.alt}` : `Show picture ${at + 1}`}
          aria-current={at === index || undefined}
          onClick={() => onPick(at)}
          className={cn(
            "h-[48px] shrink-0 cursor-interactive overflow-hidden rounded-sm ring-1 ring-white/10",
            "transition-[opacity,box-shadow] duration-(--duration-fast) motion-reduce:transition-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            at === index ? "opacity-100 ring-2 ring-white/80" : "opacity-50 pointer-hover:opacity-90",
          )}
        >
          <img
            src={item.src}
            alt=""
            draggable={false}
            loading="lazy"
            className={cn("h-full w-auto max-w-[96px] object-cover", groundClass(item.ground))}
          />
        </button>
      ))}
    </div>
  );
}
