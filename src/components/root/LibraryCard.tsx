/**
 * One remembered page as a card: its name, the first lines of what it is
 * about, and when it was read. The whole card is the link; the bookmark and
 * remove controls sit on it and take their own clicks.
 */
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/Hint";
import { Icons } from "@/lib/ui/icons";
import DocIconClient from "@/components/docs/markdown/DocIconClient";
import { shortAgo, toggleBookmark, type LibraryEntry } from "@/lib/store/library";
import { warm } from "@/lib/pages";
import { usePageMark } from "@/components/docs/Tooltip";

const CONTROL =
  "grid size-[24px] cursor-interactive place-items-center rounded-md text-neutral-500 " +
  "transition-[opacity,background-color] duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:bg-foreground/[0.08] pointer-hover:text-neutral-900 " +
  "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-neutral-400 focus-visible:outline-none";

export function LibraryCard({ entry, kept, onForget }: { entry: LibraryEntry; kept: boolean; onForget?: () => void }) {
  const mark = usePageMark(entry.path);
  const summary = mark?.summary;
  const pageGlyph = <Icons.page className="size-icon shrink-0 text-neutral-400" />;
  return (
    <div
      className={cn(
        "group relative flex h-[124px] flex-col gap-xs rounded-lg border border-hairline bg-raised p-md dark:bg-foreground/[0.045]",
        "transition-[border-color,background-color] duration-(--duration-fast) motion-reduce:transition-none",
        "pointer-hover:border-neutral-300 dark:pointer-hover:bg-foreground/[0.05] has-[a:focus-visible]:ring-1 has-[a:focus-visible]:ring-neutral-400",
      )}
    >
      <Link
        to={`/${entry.path}`}
        aria-label={entry.title}
        onPointerEnter={() => warm(entry.path)}
        className="absolute inset-0 cursor-interactive rounded-lg focus-visible:outline-none"
      />
      <div className="pointer-events-none flex min-w-0 items-center gap-sm">
        {entry.icon ? (
          <DocIconClient src={entry.icon} alt="" className="size-icon shrink-0" fallback={pageGlyph} />
        ) : (
          pageGlyph
        )}
        <span className="min-w-0 truncate text-label tracking-[-0.01em] text-neutral-900">{entry.title}</span>
      </div>
      <p className="pointer-events-none line-clamp-3 text-caption leading-[1.45] text-neutral-500">
        {summary || entry.path.replaceAll("/", " / ")}
      </p>
      <span className="pointer-events-none mt-auto text-caption text-neutral-500 tabular-nums">{shortAgo(entry.at)}</span>

      <div className="absolute right-[8px] bottom-[8px] flex items-center gap-2xs">
        <Hint label={kept ? "Remove the bookmark" : "Bookmark"}>
          <button
            type="button"
            aria-label={kept ? `Remove ${entry.title} from bookmarks` : `Bookmark ${entry.title}`}
            aria-pressed={kept}
            onClick={() => toggleBookmark(entry)}
            className={cn(CONTROL, kept ? "text-neutral-700" : "opacity-0 group-hover:opacity-100")}
          >
            <Icons.bookmark className="size-glyph" fill={kept ? "currentColor" : "none"} />
          </button>
        </Hint>
        {onForget && (
          <Hint label="Remove from recents">
            <button
              type="button"
              aria-label={`Remove ${entry.title} from recents`}
              onClick={onForget}
              className={cn(CONTROL, "opacity-0 group-hover:opacity-100")}
            >
              <Icons.dismiss className="size-glyph" />
            </button>
          </Hint>
        )}
      </div>
    </div>
  );
}
