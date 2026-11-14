/**
 * What the reader did last, under the search field.
 *
 * Two lists behind two tabs, because they answer the same question — "take me
 * back to a page I already know" — and only one of them is ever the answer.
 * Recents is the tab that opens, because it is true on the first session and
 * bookmarks are not.
 *
 * Every row carries its own bookmark flag on the left. Keeping a page is a
 * one-click act from the list the reader is already looking at, which is what
 * makes the Bookmarks tab fill up at all — a bookmark buried in a page menu
 * gets used by nobody.
 *
 * The list fades out at the bottom rather than ending on a cut row: the panel
 * is as tall as the window leaves it, so where it ends is an accident of the
 * window size and should not read as the end of the list.
 *
 * A cold window — no recents and no bookmarks — has no trail to show, so it
 * shows `ExploreColumns` instead of an empty pair of tabs.
 */
import { Link, useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/Hint";
import { Icons } from "@/lib/ui/icons";
import DocIconClient from "@/components/docs/markdown/DocIconClient";
import { FadeList } from "@/components/ui/FadeList";
import { forget, shortAgo, toggleBookmark, useLibrary, type LibraryEntry } from "@/lib/store/library";
import { warm } from "@/lib/pages";
import { useRowTip } from "@/components/docs/Tooltip";
import { ExploreColumns } from "@/components/root/ExploreColumns";
import { Keycap, SMALL_KEY } from "@/components/ui/Keycap";
import { COMMAND_KEY } from "@/lib/hotkeys";

type Tab = "recents" | "bookmarks";

const TABS: Array<{ id: Tab; label: string; icon: typeof Icons.recent }> = [
  { id: "recents", label: "Recents", icon: Icons.recent },
  { id: "bookmarks", label: "Bookmarks", icon: Icons.bookmark },
];

/**
 * One remembered page.
 *
 * The whole row is the link. A row where only the words are clickable lights
 * up under the pointer and then does nothing when it is pressed, which is the
 * worst thing a list of links can do. The two controls sit ON the link and
 * take their own clicks: the flag hangs off the left edge, so the page marks
 * of kept and unkept rows stay on one axis with the clock in the tab above.
 */
function LibraryRow({ entry, kept, onForget }: { entry: LibraryEntry; kept: boolean; onForget?: () => void }) {
  // Anchored on the name, not the row: the row is as wide as the column, and
  // the box belongs over the words it is about.
  const { anchorRef, pointer, tip } = useRowTip<HTMLSpanElement>(entry.path, "above");
  return (
    <div
      className={cn(
        // 32px, not the shared --spacing-row (30px) the sidebar's rows still
        // use: this row measures 32px in the design, and the two rows are
        // drawn by different components, so nothing else moves for it.
        // `shrink-0` is the height: the list is a flex column, so a long list
        // squeezed every row under its stated height and the rows read tighter
        // the more pages the reader had open.
        "group relative flex h-[32px] shrink-0 items-center gap-sm rounded-lg px-sm",
        "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
        "pointer-hover:bg-neutral-100",
      )}
    >
      <Link
        to={`/${entry.path}`}
        aria-label={entry.title}
        {...pointer}
        onPointerEnter={() => {
          warm(entry.path);
          pointer.onPointerEnter();
        }}
        className="absolute inset-0 cursor-interactive rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      />

      <Hint label={kept ? "Remove the bookmark" : "Bookmark"} className="absolute -left-[13px] top-1/2 -translate-y-1/2">
      <button
        type="button"
        aria-label={kept ? `Remove ${entry.title} from bookmarks` : `Bookmark ${entry.title}`}
        aria-pressed={kept}
        onClick={(() => toggleBookmark(entry))}
        className={cn(
          "grid size-[15px] cursor-interactive place-items-center rounded-sm",
          // An unkept row shows its flag only under the pointer or the
          // keyboard, so a list of unkept pages is a list of pages and not a
          // column of empty outlines.
          kept
            ? "text-brand"
            : "text-neutral-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          "transition-opacity duration-(--duration-fast) motion-reduce:transition-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        <Icons.bookmark
          className="size-[11px]"
          fill={kept ? "currentColor" : "none"}
        />
      </button>
      </Hint>

      {entry.icon ? (
        <DocIconClient
          src={entry.icon}
          alt=""
          className="pointer-events-none size-[15px] shrink-0"
          // The install ships a few pages whose icon file is not in it. A
          // blank where every neighbour has a mark reads as a fault.
          fallback={<Icons.page className="pointer-events-none size-[15px] shrink-0 text-neutral-400" />}
        />
      ) : (
        <Icons.page className="pointer-events-none size-[15px] shrink-0 text-neutral-400" />
      )}
      {/* As wide as the name, with the space after it apart, so the tooltip
          measures the words and not the row. */}
      <span ref={anchorRef} className="pointer-events-none min-w-0 truncate text-[13.5px] tracking-[-0.01em] text-neutral-800">
        {entry.title}
      </span>
      <span className="flex-1" />
      {tip}
      <span className="pointer-events-none shrink-0 text-[11.5px] text-neutral-500 tabular-nums">
        {shortAgo(entry.at)}
      </span>

      {/* The trail is the reader's, so a page can be taken out of it. The
          control holds its width whether it shows or not, so no row moves
          when the pointer crosses it. */}
      <span className="relative grid size-[15px] shrink-0 place-items-center">
        {onForget && (
          <Hint label="Remove from recents">
          <button
            type="button"
            aria-label={`Remove ${entry.title} from recents`}
            onClick={(onForget)}
            className={cn(
              "grid size-[15px] cursor-interactive place-items-center rounded-sm text-neutral-400",
              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              "transition-opacity duration-(--duration-fast) motion-reduce:transition-none",
              "pointer-hover:text-neutral-800",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            )}
          >
            <Icons.dismiss className="size-[11px]" />
          </button>
          </Hint>
        )}
      </span>
    </div>
  );
}

export function LibraryPanel({ className }: { className?: string }) {
  const library = useLibrary();
  // The open tab lives in the URL, so the panel's own Bookmarks label and the
  // one in the sidebar arrive at the same place.
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "bookmarks" ? "bookmarks" : "recents";
  const setTab = (next: Tab) =>
    setParams(next === "recents" ? {} : { tab: next }, { replace: true });
  const entries = library[tab];
  const kept = new Set(library.bookmarks.map((entry) => entry.path));

  // Cold is BOTH lists empty, not just the open tab: a reader with bookmarks
  // and no recents is still a returning reader, and keeps the tabs they know.
  if (library.recents.length === 0 && library.bookmarks.length === 0) {
    return <ExploreColumns className={className} />;
  }

  return (
    <section className={cn("flex min-h-0 flex-col gap-sm", className)}>
      <div
        role="tablist"
        aria-label="Pages you have read"
        // The row overhangs the column by its own padding, so a tab's label
        // sits on the same left axis as the heading above it and only the
        // chip reaches past.
        className="-ml-sm flex items-center gap-xs"
      >
        {TABS.map(({ id, label, icon: Mark }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={(() => setTab(id))}
              className={cn(
                "flex cursor-interactive items-center gap-sm rounded-lg px-sm py-[6px] text-[13.5px] font-medium tracking-[-0.012em]",
                "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
                active
                  ? "border border-hairline bg-raised text-neutral-950 shadow-chip"
                  : "border border-transparent text-neutral-500 pointer-hover:text-neutral-800",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              <Mark className="size-[13px] shrink-0 translate-y-[0.5px]" />
              {label}
            </button>
          );
        })}
      </div>

      {/* The list takes the height the page gives it, whichever tab is open
          and however many rows it has. A box that grew with its content would
          move the greeting and the field every time the reader crossed
          between the two tabs. */}
      <div className="min-h-0 flex-1">
        {entries.length === 0 ? (
          <p className="px-sm py-md text-meta text-neutral-500">
            {tab === "recents" ? (
              "Pages you open show up here."
            ) : (
              <>
                Press{" "}
                <span className="inline-flex translate-y-[-1px] gap-2xs align-middle">
                  <Keycap className={SMALL_KEY}>{COMMAND_KEY}</Keycap>
                  <Keycap className={SMALL_KEY}>D</Keycap>
                </span>{" "}
                or the bookmark button on a page to save it for later.
              </>
            )}
          </p>
        ) : (
          <FadeList
            // An `overflow-y-auto` scroller clips X too, not only Y — the row's
            // bookmark flag hangs 13px left of the row (see LibraryRow), and
            // `-mx-sm` only pulled the scroller out 8px, so 5px of every flag
            // was cut off. `-ml-[21px] pl-[13px]` keeps the row itself exactly
            // where `-mx-sm` put it (21 - 13 = 8, the same cancel as before)
            // while moving the scroller's own clipped edge 13px further out —
            // enough for the flag to clear it.
            className="-mr-sm -ml-[21px] h-full pl-[13px]"
            deps={[tab, entries.length]}
          >
            {entries.map((entry) => (
              <LibraryRow
                // A page read twice is two lines, so the path is not a key
                // here. The id is the backend's; a visit made in this session
                // has none until the next load, and falls back to its time.
                key={entry.id ?? `${entry.path}-${entry.at}`}
                entry={entry}
                kept={kept.has(entry.path)}
                onForget={tab === "recents" && entry.id !== undefined ? () => forget(entry.id!) : undefined}
              />
            ))}
          </FadeList>
        )}
      </div>
    </section>
  );
}
