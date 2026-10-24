/**
 * The documentation, as one list.
 *
 * Everything opens IN PLACE. A group opens onto its branches, a branch onto its
 * folders, a folder onto the folders and pages inside it, and none of it
 * replaces what is above it — the reader never loses the path they came in by,
 * and one scrollbar covers the whole tree. An earlier version swapped the
 * panel's contents for the branch you picked and gave you a back arrow to undo
 * it; that turned every look sideways into two clicks and a lost position.
 *
 * One at a time at every level. Two groups open at once, or two folders, puts
 * two lists of near-identical node names on screen and the indent is the only
 * thing telling them apart.
 *
 * The folders inside a branch are the index's, worked out when the build is
 * read — see `place.rs`. This file draws them and decides nothing about them.
 *
 * The list is windowed. A branch of twelve hundred rows costs a second of
 * layout on the click that opens it, and pays that cost again on every scroll,
 * if all of it is in the DOM. Windowing is also why the headers that must stay
 * on screen — every open row above the reader — are drawn OVER the list rather
 * than stuck to it: a windowed row rides on a transform, and a transform is
 * what `position: sticky` measures against, so a sticky row inside the window
 * sticks to the wrong box.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { groupIcon } from "@/lib/ui/icons";
import { VirtualList } from "@/components/ui/VirtualList";
import { rowsOf, type TreeBranch } from "@/lib/landing/tree";
import { warmIcons } from "@/lib/icons";
import type { Hit } from "@/lib/search";
import { SidebarRow } from "./SidebarRow";

/** Every row in the panel is this tall. `--spacing-row` states it in CSS; the
    windowing needs the same number in JavaScript. */
const ROW = 30;

/** A branch sits this far in from its group, and every level below it one step
    further: the step that puts a row's mark under the name of the row above. */
const BRANCH_INDENT = 19;
const STEP = 23;

function indent(depth: number): React.CSSProperties | undefined {
  if (depth === 0) return undefined;
  const left = BRANCH_INDENT + STEP * (depth - 1);
  return { marginLeft: left, width: `calc(100% - ${left}px)` };
}

interface PageTreeProps {
  groups: TreeBranch[];
  /** The page on screen, so the panel can mark it. */
  currentPath?: string;
  /** The pages the reader keeps, marked in the list they are read from. */
  bookmarked?: Set<string>;
  className?: string;
}

/** One drawn line of the tree. Depth 0 is a group, 1 a branch, and below that
    the folders; a page is one deeper than the row it sits in. */
type Line =
  | { kind: "folder"; folder: TreeBranch; depth: number; open: boolean }
  | { kind: "page"; page: Hit; depth: number };

/** What is open: one id per depth, outermost first. */
type Open = string[];

function linesOf(folders: TreeBranch[], open: Open, depth = 0, lines: Line[] = []): Line[] {
  for (const folder of folders) {
    const isOpen = open[depth] === folder.id;
    lines.push({ kind: "folder", folder, depth, open: isOpen });
    if (!isOpen) continue;
    if (folder.lead) lines.push({ kind: "page", page: folder.lead, depth: depth + 1 });
    linesOf(folder.branches, open, depth + 1, lines);
    for (const page of folder.pages) lines.push({ kind: "page", page, depth: depth + 1 });
  }
  return lines;
}

/** The ids of the folders around a page, outermost first, or null. */
function pathTo(folders: TreeBranch[], path: string): Open | null {
  for (const folder of folders) {
    if (rowsOf(folder).some((page) => page.path === path)) return [folder.id];
    const inner = pathTo(folder.branches, path);
    if (inner) return [folder.id, ...inner];
  }
  return null;
}

/** Every page under a folder, in the order the panel draws them. */
function pagesUnder(folder: TreeBranch): Hit[] {
  return [...(folder.lead ? [folder.lead] : []), ...folder.branches.flatMap(pagesUnder), ...folder.pages];
}

/** The icons of the rows that opening `folder` shows: its own, not deeper. */
function iconsShownBy(folder: TreeBranch): string[] {
  const rows = [...(folder.lead ? [folder.lead] : []), ...folder.branches, ...folder.pages];
  return rows.flatMap((row) => (row.icon ? [row.icon] : []));
}

/* What the tree has open, kept outside it: the panel unmounts when it is
   hidden, and showing it again must show what the reader left, not a fresh
   tree. Nothing opens by itself. The tree starts closed, and it opens only
   for the reader's click or to show the page the reader is on. */
let kept: Open = [];
/** The last page the tree opened itself to show, so showing the panel again
    on the same page does not open again what the reader has closed. */
let followed: string | undefined;

/** Shows the page on screen in the panel again, whatever the reader closed
    or scrolled since. The shell opens the panel on the same event. */
export const REVEAL = "houdinimd:reveal";
export function revealInSidebar() {
  followed = undefined;
  window.dispatchEvent(new Event(REVEAL));
}

export function PageTree({ groups, currentPath, bookmarked, className }: PageTreeProps) {
  // Open onto a new page from the first render: opened from the effect below,
  // the panel drew its closed groups for a frame first.
  const [open, setOpen] = useState<Open>(() =>
    currentPath && currentPath !== followed ? (pathTo(groups, currentPath) ?? kept) : kept,
  );
  useEffect(() => {
    kept = open;
  }, [open]);
  const [top, setTop] = useState(0);

  const lines = useMemo(() => linesOf(groups, open), [groups, open]);

  /* The panel follows the reader. A page reached from anywhere but this panel
     — the search overlay, a link in the text, the history arrows — leaves the
     panel showing wherever it was left, which is the wrong place by definition.
     Opening every folder the page sits in makes the panel say where the reader
     IS, not where they last clicked. Before the paint, so the list is never
     drawn with the new page and the old folders. */
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const ask = () => setAsked((n) => n + 1);
    window.addEventListener(REVEAL, ask);
    return () => window.removeEventListener(REVEAL, ask);
  }, []);

  useLayoutEffect(() => {
    if (!currentPath || currentPath === followed || groups.length === 0) return;
    // Once for a page, found or not. A category that lands late must not open
    // itself under the reader's hands.
    followed = currentPath;
    const path = pathTo(groups, currentPath);
    if (path) setOpen(path);
    revealed.current = undefined;
  }, [currentPath, groups, asked]);

  /* Where that page sits in the list, so the list can scroll to it — ONCE,
     on arriving. Opening a folder further down moves that row, and a list
     that chased it would throw the reader back to a page they opened minutes
     ago every time they open something. */
  const revealed = useRef<string | undefined>(undefined);
  // Only once the folders are the new page's. The render before that still has
  // the old ones open, and a page found among them was scrolled to, then moved
  // by the folders closing above it, and left off screen.
  const wants = currentPath !== revealed.current && currentPath === followed;
  const at = useMemo(
    () => lines.findIndex((line) => line.kind === "page" && line.page.path === currentPath),
    [lines, currentPath],
  );
  const reveal = wants ? at : -1;
  // Marked only once the row is actually in the list: the tree arrives after
  // the first paint, and marking a page revealed before its row exists is a
  // reveal that never happens.
  useEffect(() => {
    if (reveal >= 0) revealed.current = currentPath;
  });

  /* The rows that must not leave: every open row above the reader. They are
     the path to whatever page is under the pointer, and a list that scrolls
     that path away stops saying where the reader is.

     A row is pinned once it would go under the rows already pinned above it —
     its depth is how many of those there are — so the pinned copy takes over
     at the moment the real row reaches that place, and a row passing behind
     it reads as scrolling under a header rather than as a row drawn twice.

     A header holds its place only while there is still something of its own
     below it — once the last row under it has gone by, its name is naming
     nothing and it scrolls away with it. */
  const pinned: Array<Extract<Line, { kind: "folder" }>> = [];
  lines.forEach((line, from) => {
    if (line.kind !== "folder" || !line.open) return;
    let end = from;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      if (next.kind === "folder" && next.depth <= line.depth) break;
      end += 1;
    }
    if (top > (from - line.depth) * ROW && top < (end - line.depth) * ROW) pinned.push(line);
  });

  /* The pinned rows are drawn over the list, not in it, so they do not get
     the scrollbar's reserved gutter that every row inside the list gets. Left
     alone, a header's count jumps right the moment it pins. The gutter is
     measured off the list and given back as padding. */
  const nav = useRef<HTMLElement>(null);
  const [gutter, setGutter] = useState(0);
  useEffect(() => {
    const list = nav.current?.querySelector<HTMLElement>("[data-list]");
    if (!list) return;
    const measure = () => setGutter(list.offsetWidth - list.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  /* Ctrl and the wheel over the panel step through the pages of the open
     branch, in the order the panel draws them: a quick way to look through a
     family of nodes. One notch is one page; the many small steps of a touchpad
     add up to one. Without the cancel, Ctrl and the wheel zoom the window. */
  const openBranch = groups.find((one) => one.id === open[0])?.branches.find((one) => one.id === open[1]);
  const navigate = useNavigate();
  useEffect(() => {
    const panel = nav.current;
    if (!panel || !openBranch) return;
    const pages = pagesUnder(openBranch);
    let sum = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      sum += event.deltaY;
      if (Math.abs(sum) < 50) return;
      const at = pages.findIndex((page) => page.path === currentPath);
      const next = pages[at < 0 ? 0 : at + Math.sign(sum)];
      sum = 0;
      if (next) navigate(`/${next.path}`);
    };
    panel.addEventListener("wheel", onWheel, { passive: false });
    return () => panel.removeEventListener("wheel", onWheel);
  }, [openBranch, currentPath, navigate]);

  /* A row that is opened or closed stays where the reader clicked it. Closing
     a folder shrinks the list, and the browser takes the lost length off the
     scroll: the reader was thrown up the list, past the row they closed. A row
     clicked in its pinned copy goes back to the place that copy held. */
  const held = useRef<{ id: string; offset: number } | null>(null);
  const toggle = (id: string, depth: number) => {
    const list = nav.current?.querySelector<HTMLElement>("[data-list]");
    const at = lines.findIndex((line) => line.kind === "folder" && line.folder.id === id);
    if (list && at >= 0) held.current = { id, offset: Math.max(depth * ROW, at * ROW - list.scrollTop) };
    setOpen((now) => (now[depth] === id ? now.slice(0, depth) : [...now.slice(0, depth), id]));
  };
  useLayoutEffect(() => {
    const want = held.current;
    held.current = null;
    const list = nav.current?.querySelector<HTMLElement>("[data-list]");
    const at = want ? lines.findIndex((line) => line.kind === "folder" && line.folder.id === want.id) : -1;
    if (list && want && at >= 0) list.scrollTop = at * ROW - want.offset;
  }, [lines]);

  const folderRow = (line: Extract<Line, { kind: "folder" }>, pinnedCopy = false) => {
    const { folder, depth, open: isOpen } = line;
    const shared = {
      label: folder.label,
      count: folder.count,
      disclosure: isOpen ? ("expanded" as const) : ("collapsed" as const),
      onClick: () => toggle(folder.id, depth),
      // The hover comes a moment before the click: the icons the click shows
      // are in by the time the rows draw.
      onPointerEnter: isOpen ? undefined : () => void warmIcons(iconsShownBy(folder)),
      style: indent(depth),
      className: pinnedCopy ? "pointer-events-auto" : undefined,
    };
    if (depth === 0) {
      const Mark = groupIcon(folder.id);
      return (
        <SidebarRow
          key={folder.id}
          {...shared}
          header
          // No chip, open or shut. The chip means "the row you are on", and it
          // is the page row's alone — a lit group and a lit page on screen
          // together read as two selections.
          mark={
            Mark ? (
              <Mark className={cn("size-[15px]", isOpen ? "text-brand" : "text-neutral-500")} />
            ) : undefined
          }
        />
      );
    }
    if (depth === 1) {
      return (
        <SidebarRow
          key={folder.id}
          {...shared}
          // `null`, not `undefined`: a branch the install ships no icon for
          // still holds the mark's column open, so the names under one group
          // stay on one axis.
          icon={folder.icon ?? null}
          quietDisclosure={!isOpen}
        />
      );
    }
    // No mark at all. A folder is a place inside the branch, not a page, and
    // the page glyph said the opposite. Leaving the slot out is also what puts
    // the folder NAME on the axis the pages under it put their ICONS on.
    return <SidebarRow key={folder.id} {...shared} />;
  };

  return (
    // `isolate` keeps the pinned headers' z-index inside the tree, so a panel
    // that opens over the tree (the version switcher) stays on top of them.
    <nav ref={nav} aria-label="Documentation" className={cn("relative isolate flex min-h-0 flex-col", className)}>
      {/* Drawn over the list, not inside it — see the note at the top of the
          file. `pointer-events-none` on the box and back on the rows, so the
          gap beside a pinned header still scrolls the list under it. */}
      {pinned.length > 0 && (
        <div
          style={{ paddingRight: gutter }}
          className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-neutral-100"
          data-pinned=""
        >
          {pinned.map((line) => folderRow(line, true))}
        </div>
      )}

      <VirtualList
        items={lines}
        rowHeight={ROW}
        reveal={reveal}
        // Every open row above a page pins over the list once it scrolls by,
        // and a page has one open row per level above it.
        revealBelow={reveal >= 0 ? lines[reveal].depth * ROW : 0}
        onTop={setTop}
        // Slack on the left for what a row draws outside its own box — the
        // bookmark flag hangs 9px past the mark, the chip's shadow spreads past
        // every edge — given back as a negative margin so the rows keep their
        // axis. The right edge is the bar's: `.thin-scroll` holds its place
        // whether the list scrolls or not, so a list that starts to scroll
        // does not step its own rows sideways.
        className="-ml-slack flex-1 pl-slack"
      >
        {(line) =>
          line.kind === "folder" ? (
            folderRow(line)
          ) : (
            <SidebarRow
              key={line.page.path}
              label={line.page.title}
              icon={line.page.icon ?? null}
              to={`/${line.page.path}`}
              selected={line.page.path === currentPath}
              kept={bookmarked?.has(line.page.path)}
              // A page starts its ICON where the folder above it starts its
              // NAME, which is what makes it read as contents of the folder
              // rather than as its neighbour.
              style={indent(line.depth)}
            />
          )
        }
      </VirtualList>
    </nav>
  );
}
