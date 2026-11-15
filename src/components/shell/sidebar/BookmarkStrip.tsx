/**
 * The pages the reader kept, as rows of the panel: icon and name, the same
 * row the tree draws, so a kept page reads the same in both places. A mark
 * with no name could only be told apart by its picture.
 *
 * With nothing kept the strip is one row tall, the height of one kept page,
 * so the first bookmark does not move the tree below it.
 */
import { Link, useLocation } from "react-router";
import { COMMAND_KEY } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { toggleBookmark, type LibraryEntry } from "@/lib/store/library";
import { Keycap } from "@/components/ui/Keycap";
import { SidebarRow } from "./SidebarRow";

/** The newest few; the heading leads to the whole list. */
const SHOWN = 4;

export function BookmarkStrip({ entries, className }: { entries: LibraryEntry[]; className?: string }) {
  const shown = entries.slice(0, SHOWN);
  const { pathname } = useLocation();

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
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/70 focus-visible:outline-none",
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

      <div className="flex min-h-row flex-col">
        {shown.length === 0 ? (
          // The same height and inset as a row of the tree, and of a row of
          // tiles: the strip must not grow the first time a page is kept, or
          // the whole tree below it steps down.
          <p className="flex h-row w-full items-center gap-[3px] px-sm text-[13px] tracking-[-0.01em] text-neutral-500">
            <Keycap flat>{COMMAND_KEY}</Keycap>
            <Keycap flat>D</Keycap>
            <span className="ml-xs">to keep a page</span>
          </p>
        ) : (
          shown.map((entry) => (
            <BookmarkRow key={entry.path} entry={entry} open={pathname === `/${entry.path}`} />
          ))
        )}
        {/* The strip shows the newest few; a cut list says how much is cut,
            and the rest is one click away on the home page. */}
        {entries.length > SHOWN && (
          <Link
            to="/?tab=bookmarks"
            className={cn(
              "flex h-row cursor-interactive items-center rounded-md px-sm text-[12px] text-neutral-500",
              "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
              "pointer-hover:bg-foreground/[0.035] dark:pointer-hover:bg-foreground/[0.045] pointer-hover:text-neutral-900",
              "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/70 focus-visible:outline-none",
            )}
          >
            {entries.length - SHOWN} more
          </Link>
        )}
      </div>
    </section>
  );
}

/** One kept page: the panel's row, marked when it is the open page, and a
    remove control that comes with the pointer or the keyboard. The control
    sits over the row, not in it: a link cannot hold a button. */
function BookmarkRow({ entry, open }: { entry: LibraryEntry; open: boolean }) {
  return (
    <div className="group/bookmark relative">
      <SidebarRow label={entry.title} icon={entry.icon ?? null} to={`/${entry.path}`} selected={open} className="pr-[28px]" />
      <button
        type="button"
        aria-label={`Remove ${entry.title} from bookmarks`}
        onClick={() => toggleBookmark(entry)}
        className={cn(
          "absolute top-1/2 right-[6px] grid size-[20px] -translate-y-1/2 cursor-interactive place-items-center rounded-sm text-neutral-400",
          "opacity-0 transition-opacity duration-(--duration-fast) group-hover/bookmark:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none",
          "pointer-hover:text-neutral-900",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand/70 focus-visible:outline-none",
        )}
      >
        <Icons.dismiss className="size-[11px]" />
      </button>
    </div>
  );
}
