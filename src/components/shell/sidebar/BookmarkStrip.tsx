/**
 * The pages the reader kept, as rows of the panel: icon and name, the same
 * row the tree draws, so a kept page reads the same in both places. A mark
 * with no name could only be told apart by its picture.
 *
 * With nothing kept the strip is one row tall, the height of one kept page,
 * so the first bookmark does not move the tree below it.
 */
import { useLocation } from "react-router";
import { COMMAND_KEY } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { toggleBookmark, type LibraryEntry } from "@/lib/store/library";
import { Keycap } from "@/components/ui/Keycap";
import { SidebarRow } from "./SidebarRow";
import { FadeList } from "@/components/ui/FadeList";

export function BookmarkStrip({ entries, className }: { entries: LibraryEntry[]; className?: string }) {
  const { pathname } = useLocation();

  return (
    <section className={cn("flex flex-col gap-2xs pb-sm", className)}>
      <h2 className="flex h-[22px] items-center px-sm text-[11.5px] font-medium tracking-[-0.005em] text-neutral-600">Bookmarks</h2>

      {entries.length === 0 ? (
        // The same height and inset as a row of the tree: the strip must not
        // grow the first time a page is kept, or the whole tree steps down.
        <p className="flex h-row w-full items-center gap-[3px] px-sm text-[13px] tracking-[-0.01em] text-neutral-500">
          <Keycap flat className="translate-y-[0.5px]">{COMMAND_KEY}</Keycap>
          <Keycap flat className="translate-y-[0.5px]">D</Keycap>
          <span className="ml-xs">to keep a page</span>
        </p>
      ) : (
        // Every kept page, in a box that stops at six and a half rows and
        // scrolls: the half row and the fade say there is more below.
        <FadeList className="max-h-[calc(var(--spacing-row)*6.5)] [scrollbar-gutter:auto]!" deps={[entries.length]}>
          {entries.map((entry) => (
            <BookmarkRow key={entry.path} entry={entry} open={pathname === `/${entry.path}`} />
          ))}
        </FadeList>
      )}
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
        className={cn("pr-[28px]", !open && "group-hover/bookmark:bg-foreground/[0.035] dark:group-hover/bookmark:bg-foreground/[0.03]")}
      />
      <button
        type="button"
        aria-label={`Remove ${entry.title} from bookmarks`}
        onClick={() => toggleBookmark(entry)}
        className={cn(
          "absolute top-1/2 right-[6px] grid size-[18px] -translate-y-1/2 cursor-interactive place-items-center rounded-[5px] text-neutral-600",
          "opacity-0 transition-opacity duration-(--duration-fast) group-hover/bookmark:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none",
          "pointer-hover:bg-foreground/[0.05] dark:pointer-hover:bg-foreground/[0.07] pointer-hover:text-neutral-950",
          "focus-visible:ring-[1.5px] focus-visible:ring-inset focus-visible:ring-neutral-500/80 focus-visible:outline-none",
        )}
      >
        <Icons.dismiss className="size-[11px]" />
      </button>
    </div>
  );
}
