/**
 * The pages the reader kept, as rows of the panel: icon and name, the same
 * row the tree draws, so a kept page reads the same in both places. A mark
 * with no name could only be told apart by its picture.
 *
 * With nothing kept the strip is one row tall, the height of one kept page,
 * so the first bookmark does not move the tree below it.
 */
import { useState } from "react";
import { useLocation } from "react-router";
import { COMMAND_KEY } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { toggleBookmark, type LibraryEntry } from "@/lib/store/library";
import { Keycap } from "@/components/ui/Keycap";
import { SidebarRow } from "./SidebarRow";

/** The newest few; the heading leads to the whole list. */
const SHOWN = 4;

export function BookmarkStrip({ entries, className }: { entries: LibraryEntry[]; className?: string }) {
  const [whole, setWhole] = useState(false);
  const shown = whole ? entries : entries.slice(0, SHOWN);
  const { pathname } = useLocation();

  return (
    <section className={cn("flex flex-col gap-2xs pb-xs", className)}>
      <h2 className="flex h-[22px] items-center px-sm text-[11.5px] font-medium tracking-[-0.005em] text-neutral-600">Bookmarks</h2>

      <div className="flex min-h-row flex-col">
        {shown.length === 0 ? (
          // The same height and inset as a row of the tree, and of a row of
          // tiles: the strip must not grow the first time a page is kept, or
          // the whole tree below it steps down.
          <p className="flex h-row w-full items-center gap-[3px] px-sm text-[13px] tracking-[-0.01em] text-neutral-500">
            <Keycap flat className="translate-y-[0.5px]">{COMMAND_KEY}</Keycap>
            <Keycap flat className="translate-y-[0.5px]">D</Keycap>
            <span className="ml-xs">to keep a page</span>
          </p>
        ) : (
          shown.map((entry) => (
            <BookmarkRow key={entry.path} entry={entry} open={pathname === `/${entry.path}`} />
          ))
        )}
        {/* The strip shows the newest few; a cut list says how much is cut
            and opens in place. */}
        {entries.length > SHOWN && (
          <button
            type="button"
            aria-expanded={whole}
            onClick={() => setWhole(!whole)}
            className={cn(
              // The caret takes the mark slot, so it stands on the icons'
              // axis and the words on the names' axis.
              "flex h-row w-full cursor-interactive items-center gap-sm rounded-md px-sm text-left text-[12px] text-neutral-500",
              "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
              "pointer-hover:bg-foreground/[0.035] dark:pointer-hover:bg-foreground/[0.045] pointer-hover:text-neutral-900",
              "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500/80 focus-visible:outline-none",
            )}
          >
            <span className="grid size-[15px] shrink-0 place-items-center">
              <Icons.expanded className={cn("size-[11px]", whole && "rotate-180")} />
            </span>
            {whole ? "Show less" : `Show ${entries.length - SHOWN} more`}
          </button>
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
      <SidebarRow label={entry.title} icon={entry.icon ?? null} to={`/${entry.path}`} selected={open}
        // The remove control covers the row's end, so the row keeps its hover
        // while the pointer is on the control.
        className={cn("pr-[28px]", !open && "group-hover/bookmark:bg-foreground/[0.035] dark:group-hover/bookmark:bg-foreground/[0.045]")}
      />
      <button
        type="button"
        aria-label={`Remove ${entry.title} from bookmarks`}
        onClick={() => toggleBookmark(entry)}
        className={cn(
          "absolute top-1/2 right-[6px] grid size-[18px] -translate-y-1/2 cursor-interactive place-items-center rounded-full text-neutral-500",
          "opacity-0 transition-opacity duration-(--duration-fast) group-hover/bookmark:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none",
          "pointer-hover:bg-foreground/[0.05] dark:pointer-hover:bg-foreground/[0.07] pointer-hover:text-neutral-950",
          "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500/80 focus-visible:outline-none",
        )}
      >
        <Icons.dismiss className="size-[11px]" />
      </button>
    </div>
  );
}
