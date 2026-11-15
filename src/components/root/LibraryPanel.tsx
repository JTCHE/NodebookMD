/**
 * What the reader did last, under the search field.
 *
 * Two lists behind two tabs, because they answer the same question — "take me
 * back to a page I already know" — and only one of them is ever the answer.
 * Recents is the tab that opens, because it is true on the first session and
 * bookmarks are not.
 *
 * Each page is a card with the start of its summary, so the reader finds a
 * page by what it is about, not only by its name.
 *
 * The list fades out at the bottom rather than ending on a cut row: where it
 * ends is an accident of the box size and should not read as the end of the list.
 *
 * A cold window — no recents and no bookmarks — has no trail to show, so it
 * shows `ExploreColumns` instead of an empty pair of tabs.
 */
import { useSearchParams } from "react-router";
import { cn } from "@/lib/utils";
import { LibraryCard } from "@/components/root/LibraryCard";
import { Icons } from "@/lib/ui/icons";
import { FadeList } from "@/components/ui/FadeList";
import { forget, useLibrary } from "@/lib/store/library";
import { ExploreColumns } from "@/components/root/ExploreColumns";
import { Keycap, SMALL_KEY } from "@/components/ui/Keycap";
import { COMMAND_KEY } from "@/lib/hotkeys";

type Tab = "recents" | "bookmarks";

const TABS: Array<{ id: Tab; label: string; icon: typeof Icons.recent }> = [
  { id: "recents", label: "Recents", icon: Icons.recent },
  { id: "bookmarks", label: "Bookmarks", icon: Icons.bookmark },
];

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
        // sits on the same left axis as the heading above it.
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
                "flex cursor-interactive items-center gap-sm rounded-lg px-sm py-[6px] text-label font-medium tracking-[-0.012em]",
                "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
                active
                  ? "text-neutral-950"
                  : "text-neutral-500 pointer-hover:text-neutral-800",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
            >
              <Mark className="size-[13px] shrink-0 translate-y-light" />
              {label}
            </button>
          );
        })}
      </div>

      {/* The list holds a box of one size, whichever tab is open
          and however many rows it has. A box that grew with its content would
          move the greeting and the field every time the reader crossed
          between the two tabs. */}
      <div className="h-list min-h-0">
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
          // Room past the cards on each side, so a card's ring is not cut by the scroller.
          <FadeList className="-mx-[3px] h-full px-[3px] pt-[3px] [--fade-size:40px]" deps={[tab, entries.length]}>
            <div className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-sm pb-[3px]">
              {entries.map((entry) => (
                <LibraryCard
                  // A page read twice is two cards, so the path is not a key.
                  key={entry.id ?? `${entry.path}-${entry.at}`}
                  entry={entry}
                  kept={kept.has(entry.path)}
                  onForget={tab === "recents" && entry.id !== undefined ? () => forget(entry.id!) : undefined}
                />
              ))}
            </div>
          </FadeList>
        )}
      </div>
    </section>
  );
}
