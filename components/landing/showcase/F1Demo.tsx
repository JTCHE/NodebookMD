"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, House, Plus } from "lucide-react";
import { GAP, INNER, MOVE_MS, outerCorner, usePlayed, type AppBox, type Base, type DemoProps } from "@/components/landing/showcase/layout";
import { Keycap, SMALL_KEY } from "@/components/ui/Keycap";
import { SITE_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

/*
 * A Houdini session, drawn here from plain shapes: the main menu, a shelf, a
 * network and a Help Browser pane with the app in it. The layout and names
 * follow Houdini, so a Houdini user knows the place; every mark is our own,
 * and no SideFX icon or picture is used.
 */

const MENU = 28;
const SHELF_TABS = 24;
const SHELF_TOOLS = 50;
const SHELF = SHELF_TABS + SHELF_TOOLS;
/** A pane's tab row, and the row of controls under it. */
const TAB = 28;
const BAR = 28;
/** The network's height on a phone, where the pane goes under it. */
const PHONE_NETWORK = 132;
/** The help pane on a desk: the width of a pane docked beside the network. */
const PANE = 480;
/** The server Houdini's help points at: the app's own. */
const ADDRESS = "localhost:48800";

/** A pane's corners: square at the top, where the panes meet the shelf; round
    with the frame at the frame's own corners. */
function corners(base: Base, left: boolean, right: boolean) {
  const outer = outerCorner(base);
  return `0 0 ${right ? outer : INNER}px ${left ? outer : INNER}px`;
}

/** The help pane, in the tab's pixels: the app sits here, under the pane's
    tab and its toolbar, as narrow as a Houdini pane, and draws itself the
    way it does in one. The page time goes at the end of the pane's tab row. */
export function pane(base: Base): AppBox {
  if (base.phone) {
    const y = GAP + PHONE_NETWORK + GAP + TAB + BAR;
    const w = base.w - 2 * GAP;
    return { x: GAP, y, w, h: base.h - y - GAP, window: w, bar: y - BAR - TAB / 2, end: true, corners: corners(base, true, true) };
  }
  const x = base.w - PANE - GAP;
  const y = MENU + SHELF + GAP + TAB + BAR;
  return { x, y, w: PANE, h: base.h - y - GAP, window: 520, bar: y - BAR - TAB / 2, end: true, corners: corners(base, false, true) };
}

/** Nodes in the network, and the page F1 opens for each. `from` is the node
    wired into each input. The chain runs top to bottom; the box, the shape to
    copy, comes in from the side, and only on a desk. */
const NODES = [
  { name: "grid1", type: "Grid", path: "/nodes/sop/grid", from: [], glyph: "grid" },
  { name: "attribwrangle1", type: "Attribute Wrangle", path: "/nodes/sop/attribwrangle", from: [0], glyph: "code" },
  { name: "scatter1", type: "Scatter", path: "/nodes/sop/scatter", from: [1], glyph: "dots" },
  { name: "copytopoints1", type: "Copy to Points", path: "/nodes/sop/copytopoints", from: [4, 2], glyph: "copy" },
  { name: "box1", type: "Box", path: "/nodes/sop/box", from: [], glyph: "box" },
] as const;
const WRANGLE = 1;
const SCATTER = 2;
const COPY = 3;
/** The node with the display flag: what the viewport shows. */
const DISPLAY = COPY;

/** The tour, on the tab's clock: F1 on one node, then on another, so the
    page follows the selection. */
const STEPS = [
  { at: 1000, node: SCATTER, press: false },
  { at: 1900, node: SCATTER, press: true },
  { at: 4800, node: COPY, press: false },
  { at: 5700, node: COPY, press: true },
];
const stepsDone = (ms: number) => STEPS.filter((step) => ms >= step.at).length;

const NODE = { w: 104, h: 26 };

/** Where each node sits, in the network's own pixels. The chain spreads down
    the network, and stops short of the words at its foot. */
function layout(phone: boolean, width: number, height: number) {
  if (phone) return NODES.slice(0, 4).map((_, i) => ({ x: 16 + i * 100, y: 40, ...NODE, w: 64 }));
  const x = Math.max(220, Math.round(width * 0.36));
  const step = Math.min(96, (height - 150) / 3);
  const y = (i: number) => Math.round(36 + i * step);
  return NODES.map((_, i) => (i === 4 ? { x: x - 170, y: y(SCATTER), ...NODE } : { x, y: y(i), ...NODE }));
}

/** A small drawing of what a node or a shelf tool makes. Ours, not SideFX's. */
function Glyph({ kind, className }: { kind: string; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  const shapes: Record<string, React.ReactNode> = {
    grid: <path d="M3 5h14M3 10h14M3 15h14M5 3v14M10 3v14M15 3v14" {...common} />,
    code: <path d="M7 5 3 10l4 5M13 5l4 5-4 5" {...common} />,
    dots: (
      <g fill="currentColor">
        {[[5, 6], [11, 4], [15, 9], [8, 11], [4, 15], [12, 15], [16, 16]].map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.4} />
        ))}
      </g>
    ),
    copy: <path d="M3 8h7v7H3zM10 5h7v7h-7z" {...common} />,
    box: <path d="M4 7l6-3 6 3v7l-6 3-6-3zM4 7l6 3 6-3M10 10v7" {...common} />,
    sphere: (
      <>
        <circle cx={10} cy={10} r={6.5} {...common} />
        <ellipse cx={10} cy={10} rx={6.5} ry={2.4} {...common} />
      </>
    ),
    tube: (
      <>
        <ellipse cx={10} cy={5} rx={5} ry={2} {...common} />
        <path d="M5 5v10c0 1.1 2.2 2 5 2s5-.9 5-2V5" {...common} />
      </>
    ),
    torus: (
      <>
        <ellipse cx={10} cy={10} rx={7} ry={4.5} {...common} />
        <ellipse cx={10} cy={10} rx={2.8} ry={1.4} {...common} />
      </>
    ),
    null: <path d="M10 3v14M3 10h14M5 5l10 10M15 5 5 15" {...common} />,
    line: <path d="M4 16 16 4" {...common} />,
    circle: <circle cx={10} cy={10} r={6.5} {...common} />,
    curve: <path d="M3 15C6 3 14 17 17 5" {...common} />,
    font: <path d="M5 16 10 4l5 12M7 12h6" {...common} />,
    file: <path d="M6 3h6l3 3v11H6zM12 3v3h3" {...common} />,
  };
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      aria-hidden
    >
      {shapes[kind]}
    </svg>
  );
}

const SHELF_TAB_NAMES = ["Create", "Modify", "Model", "Polygon", "Deform", "Texture", "Rigging", "Characters", "Constraints", "Guide Process", "Terrain FX", "Simple FX", "Volume"];
const TOOLS = [
  ["box", "Box"],
  ["sphere", "Sphere"],
  ["tube", "Tube"],
  ["torus", "Torus"],
  ["grid", "Grid"],
  ["null", "Null"],
  ["line", "Line"],
  ["circle", "Circle"],
  ["curve", "Curve"],
  ["font", "Font"],
  ["file", "File"],
] as const;

/** A pane's row of tabs, with the one tab it shows. */
function PaneTabs({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex shrink-0 items-end gap-px bg-[oklch(0.2_0_0)] pl-1 text-[12px]"
      style={{ height: TAB }}
    >
      <span className="flex h-[24px] items-center gap-2 rounded-t-[3px] bg-[oklch(0.3_0_0)] px-3 text-white/90">{children}</span>
      <Plus className="mb-1.5 ml-1.5 size-3.5 text-white/35" />
    </div>
  );
}

export function F1Demo({ go, base, clock }: DemoProps) {
  const { phone } = base;
  // The tab opens mid-session: the wrangle is selected, its page open.
  const [selected, setSelected] = useState<number | null>(WRANGLE);
  const [pressed, setPressed] = useState(false);
  const [yours, setYours] = useState(false);
  const [shown, setShown] = useState<string>(NODES[WRANGLE].path);
  const network = base.w - PANE - 3 * GAP;
  const top = phone ? GAP : MENU + SHELF + GAP;
  const spots = layout(phone, network, base.h - top - GAP - TAB - BAR);
  const nodes = NODES.slice(0, spots.length);
  const outer = outerCorner(base);

  const press = useCallback(
    (index: number | null) => {
      if (index === null) return;
      setPressed(true);
      setTimeout(() => setPressed(false), 160);
      setShown(NODES[index].path);
      go(NODES[index].path, NODES[index].type);
    },
    [go],
  );

  // The page opens once the app has moved into the pane: a page that draws
  // during the move takes the move's first frames.
  useEffect(() => {
    const timer = setTimeout(() => go(NODES[WRANGLE].path, NODES[WRANGLE].type), MOVE_MS);
    return () => clearTimeout(timer);
    // Once, when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = usePlayed(clock, stepsDone);
  useEffect(() => {
    const step = STEPS[done - 1];
    if (!step || yours) return;
    if (step.press) press(step.node);
    else setSelected(step.node);
    // Each step once, as the clock passes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  // The reader's own F1, while this tab is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F1") return;
      event.preventDefault();
      setYours(true);
      press(selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, selected]);

  const key = (
    <button
      type="button"
      aria-label="Press F1"
      onClick={() => {
        setYours(true);
        if (selected === null) setSelected(SCATTER);
        press(selected ?? SCATTER);
      }}
      className="mx-0.5 cursor-pointer align-baseline"
    >
      <Keycap className={cn(SMALL_KEY, "transition-[translate,box-shadow] duration-100", pressed && "translate-y-0.5 shadow-none")}>
        F1
      </Keycap>
    </button>
  );

  /** A wire from the output of `a` into input `slot` of `b`. */
  const wire = (a: number, b: number, slot: number, inputs: number) => {
    const from = spots[a];
    const to = spots[b];
    if (phone) return `M${from.x + from.w} ${from.y + from.h / 2} L${to.x} ${to.y + to.h / 2}`;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h + 4;
    const x2 = to.x + (to.w * (slot + 1)) / (inputs + 1);
    const y2 = to.y - 4;
    const bend = (y2 - y1) / 2;
    return `M${x1} ${y1} C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-[oklch(0.17_0_0)] text-[12px] text-white/75 select-none">
      {!phone && (
        <>
          <div
            className="flex shrink-0 items-center gap-4 bg-[oklch(0.24_0_0)] px-3 text-white/70"
            style={{ height: MENU }}
          >
            {["File", "Edit", "Render", "Assets", "Windows", "Help"].map((item) => (
              <span key={item}>{item}</span>
            ))}
            <span className="flex-1" />
            <span className="rounded-[3px] bg-black/25 px-2 py-0.5 text-white/60">Build ▾</span>
          </div>
          <div
            className="flex shrink-0 flex-col bg-[oklch(0.26_0_0)]"
            style={{ height: SHELF }}
          >
            <div
              className="flex items-end gap-px overflow-hidden bg-[oklch(0.21_0_0)] pl-1 text-[11px] whitespace-nowrap text-white/55"
              style={{ height: SHELF_TABS }}
            >
              {SHELF_TAB_NAMES.map((name, i) => (
                <span
                  key={name}
                  className={cn("rounded-t-[3px] px-2.5 py-[3px]", i === 0 ? "bg-[oklch(0.26_0_0)] text-white/90" : "bg-[oklch(0.23_0_0)]")}
                >
                  {name}
                </span>
              ))}
            </div>
            <div className="flex flex-1 items-center gap-1 overflow-hidden px-2">
              {TOOLS.map(([glyph, name]) => (
                <span
                  key={name}
                  className="flex w-[50px] shrink-0 flex-col items-center gap-0.5 text-[10.5px] text-white/65"
                >
                  <Glyph
                    kind={glyph}
                    className="size-[20px] text-[oklch(0.8_0.08_230)]"
                  />
                  {name}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      <div
        className={cn("relative flex min-h-0 flex-1", phone && "flex-col")}
        style={{ gap: GAP, padding: GAP }}
      >
        <section
          className="relative flex shrink-0 flex-col overflow-hidden bg-[oklch(0.3_0_0)]"
          style={
            phone
              ? { height: PHONE_NETWORK, borderRadius: `${outer}px ${outer}px ${INNER}px ${INNER}px` }
              : { width: network, borderRadius: corners(base, true, false) }
          }
        >
          {!phone && (
            <>
              <PaneTabs>/obj/geo1</PaneTabs>
              <div
                className="flex shrink-0 items-center gap-1.5 border-b border-black/30 bg-[oklch(0.27_0_0)] px-2 text-white/70"
                style={{ height: BAR }}
              >
                <ArrowLeft className="size-3.5 text-white/40" />
                <ArrowRight className="size-3.5 text-white/40" />
                <span className="ml-1 rounded-[3px] bg-black/25 px-2 py-0.5">obj</span>
                <ChevronRight className="size-3 text-white/35" />
                <span className="rounded-[3px] bg-black/25 px-2 py-0.5 text-white/90">geo1</span>
              </div>
            </>
          )}
          <div
            className="relative flex-1"
            style={{
              backgroundImage: "radial-gradient(oklch(1 0 0 / 0.07) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
            onPointerDown={() => {
              setYours(true);
              setSelected(null);
            }}
          >
            <svg className="pointer-events-none absolute inset-0 size-full">
              {nodes.flatMap((node, b) =>
                node.from
                  .map((a, slot) => ({ a, slot }))
                  .filter(({ a }) => a < spots.length)
                  .map(({ a, slot }) => (
                    <path
                      key={`${a}-${b}`}
                      d={wire(a, b, slot, node.from.length)}
                      fill="none"
                      stroke="oklch(0.78 0 0)"
                      strokeWidth={1.2}
                    />
                  )),
              )}
            </svg>
            {nodes.map((node, i) => {
              const spot = spots[i];
              const on = selected === i;
              return (
                <button
                  key={node.name}
                  type="button"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    setYours(true);
                    setSelected(i);
                  }}
                  onDoubleClick={() => press(i)}
                  className={cn("group absolute flex cursor-pointer", phone ? "flex-col items-start gap-1" : "items-center gap-2.5")}
                  style={{ left: spot.x, top: spot.y }}
                >
                  {/* Houdini's node: a flag cap at each end, the body between. */}
                  <span
                    className={cn(
                      "relative flex rounded-[5px] ring-1 transition-shadow duration-150",
                      on ? "ring-2 ring-[oklch(0.88_0.17_95)]" : "ring-black/60",
                    )}
                    style={{ width: spot.w, height: spot.h }}
                  >
                    {!phone && <span className="w-3 shrink-0 rounded-l-[5px] border-r border-black/40 bg-[oklch(0.52_0_0)]" />}
                    <span
                      className={cn(
                        "grid flex-1 place-items-center bg-[oklch(0.68_0_0)] text-[oklch(0.25_0_0)] transition-colors group-hover:bg-[oklch(0.74_0_0)]",
                        phone && "rounded-[5px]",
                      )}
                    >
                      <Glyph
                        kind={node.glyph}
                        className="size-[16px]"
                      />
                    </span>
                    {!phone && (
                      <span
                        className={cn(
                          "w-3 shrink-0 rounded-r-[5px] border-l border-black/40",
                          i === DISPLAY ? "bg-[oklch(0.6_0.15_245)]" : "bg-[oklch(0.52_0_0)]",
                        )}
                      />
                    )}
                    {!phone &&
                      node.from.map((_, slot) => (
                        <span
                          key={slot}
                          className="absolute -top-[4px] h-[4px] w-[8px] -translate-x-1/2 rounded-t-full bg-[oklch(0.78_0_0)]"
                          style={{ left: `${((slot + 1) * 100) / (node.from.length + 1)}%` }}
                        />
                      ))}
                    {!phone && <span className="absolute -bottom-[4px] left-1/2 h-[4px] w-[8px] -translate-x-1/2 rounded-b-full bg-[oklch(0.78_0_0)]" />}
                  </span>
                  <span
                    className={cn(
                      "text-left leading-tight",
                      phone ? "max-w-[80px] truncate text-[11px]" : "text-[13px]",
                      on ? "text-[oklch(0.88_0.17_95)]" : "text-white/90",
                    )}
                  >
                    {node.name}
                  </span>
                </button>
              );
            })}

            {/* Not Houdini: the page's own note on what to do here, with the
                key in it. */}
            <p
              className={cn(
                "absolute rounded-lg bg-black/45 px-3 py-2 leading-relaxed text-white/80 backdrop-blur-sm",
                phone ? "right-3 bottom-3 left-3 text-[12px]" : "bottom-4 left-4 max-w-[340px] text-[13px]",
              )}
            >
              Select a node and press {key}
              {!phone && <>: its page opens in Houdini&apos;s own help pane, from {SITE_NAME}. You set it up once.</>}
            </p>
          </div>
        </section>

        <section
          className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[oklch(0.3_0_0)]"
          style={{ borderRadius: corners(base, phone, true) }}
        >
          <PaneTabs>Help Browser</PaneTabs>
          {/* Houdini's own browser, pointed at the app. */}
          <div
            className="flex shrink-0 items-center gap-1.5 border-b border-black/30 bg-[oklch(0.27_0_0)] px-2 text-white/60"
            style={{ height: BAR }}
          >
            <ArrowLeft className="size-3.5" />
            <ArrowRight className="size-3.5 text-white/35" />
            <House className="size-3.5" />
            <span className="ml-1 min-w-0 flex-1 truncate rounded-[3px] bg-black/30 px-2 py-0.5 font-mono text-[11px] text-white/70">
              {ADDRESS}
              {shown}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
