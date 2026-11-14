/**
 * The pages the reader kept, as a row of marks.
 *
 * Icon only, no name: a bookmark is a page the reader chose, so they already
 * know it by its mark, and six marks in the width of one row is the point of
 * putting them here rather than in a list. The name is one hover away,
 * in the tooltip every page link has.
 *
 * The strip holds its height with nothing in it. A panel that grows a row the
 * first time a reader keeps a page moves everything under it, and the row
 * below is the tree — the part of the panel the reader is looking at.
 */
import { useRef, useState } from "react";
import { Link } from "react-router";
import { warm } from "@/lib/pages";
import { COMMAND_KEY } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import DocIconClient from "@/components/docs/markdown/DocIconClient";
import { DocTooltip } from "@/components/docs/Tooltip";
import type { LibraryEntry } from "@/lib/store/library";
import { Keycap } from "@/components/ui/Keycap";

/** How many fit on the row at the panel's width. */
const SHOWN = 6;

export function BookmarkStrip({ entries, className }: { entries: LibraryEntry[]; className?: string }) {
  const shown = entries.slice(0, SHOWN);

  return (
    <section className={cn("flex flex-col gap-2xs", className)}>
      {/* A heading that is also the way to the full list: the arrow comes
          with the pointer, so at rest it reads as a label. */}
      <Link
        to="/?tab=bookmarks"
        className={cn(
          "group/head flex h-[22px] cursor-interactive items-center gap-2xs self-start rounded-md px-sm text-[11.5px] font-medium tracking-[-0.005em] text-neutral-500",
          "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
          "pointer-hover:text-neutral-900",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        Bookmarks
        <Icons.collapsed
          className={cn(
            "size-[10px] translate-y-[0.5px] opacity-0 transition-[opacity,translate] duration-(--duration-fast) motion-reduce:transition-none",
            "-translate-x-[2px] group-hover/head:translate-x-0 group-hover/head:opacity-100 group-focus-visible/head:opacity-100",
          )}
        />
      </Link>

      <div className="flex min-h-[32px] flex-wrap items-center gap-[2px]">
        {shown.length === 0 ? (
          // The same height as a row of tiles: the strip must not grow the
          // first time a page is kept, or the whole tree below it steps down.
          <p className="flex h-[32px] w-full items-center gap-[3px] px-sm text-[12px] text-neutral-400">
            <Keycap flat>{COMMAND_KEY}</Keycap>
            <Keycap flat>D</Keycap>
            <span className="ml-[5px]">to keep a page</span>
          </p>
        ) : (
          shown.map((entry) => <BookmarkTile key={entry.path} entry={entry} />)
        )}
      </div>
    </section>
  );
}

/** One kept page. Its name and what it is about show on hover, in the same
    tooltip a link in the page shows, so the two never read differently. */
function BookmarkTile({ entry }: { entry: LibraryEntry }) {
  const tile = useRef<HTMLAnchorElement>(null);
  const [hovered, setHovered] = useState(false);
  return (
    <>
      <Link
        to={`/${entry.path}`}
        ref={tile}
        onPointerEnter={() => warm(entry.path)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setHovered(false)}
        aria-label={entry.title}
        className={cn(
          // Square, and as quiet as a row of the panel: a mark on the
          // ground until the pointer lifts it. 8px round the 16px icon, the
          // padding every row has, so the first mark stands on the axis.
          "grid size-[32px] shrink-0 cursor-interactive place-items-center rounded-md",
          "transition-[background-color,box-shadow] duration-(--duration-fast) motion-reduce:transition-none",
          "pointer-hover:bg-raised pointer-hover:shadow-chip active:bg-neutral-200",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {entry.icon ? (
          <DocIconClient
            src={entry.icon}
            alt=""
            className="size-[16px]"
            // The install ships a few pages whose icon file is not in
            // it. A blank tile reads as a fault.
            fallback={<Initials title={entry.title} />}
          />
        ) : (
          <Initials title={entry.title} />
        )}
      </Link>
      {hovered && <DocTooltip slug={entry.path} anchorRef={tile} />}
    </>
  );
}

/** Two letters for a page with no icon: a row of the same page glyph tells
    the pages apart by position only. `Group by Range` gives GR, `AddItUp`
    gives AI, `Solaris` gives So. */
function initials(title: string): string {
  const words = title.split(/[\s._\-/:]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const word = words[0] ?? "";
  const capitals = word.match(/[A-Z]/g);
  if (capitals && capitals.length > 1) return capitals[0] + capitals[1];
  return word.slice(0, 1).toUpperCase() + word.slice(1, 2);
}

function Initials({ title }: { title: string }) {
  return (
    <span aria-hidden="true" className="text-[11px] leading-none font-semibold tracking-[-0.02em] text-neutral-500">
      {initials(title)}
    </span>
  );
}
