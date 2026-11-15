/**
 * One remembered page, drawn as a small window onto the page itself. Its name
 * and the time read sit under the window, so the window holds only the page.
 */
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/Hint";
import { Icons } from "@/lib/ui/icons";
import { shortAgo, toggleBookmark, type LibraryEntry } from "@/lib/store/library";
import { warm } from "@/lib/pages";
import { PagePreview } from "@/components/root/PagePreview";

const CONTROL =
  "grid size-[22px] cursor-interactive place-items-center rounded-md text-neutral-500 " +
  "transition-[opacity,background-color,color] duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:bg-foreground/[0.06] pointer-hover:text-neutral-900 active:bg-foreground/[0.1] " +
  "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none";

export function LibraryCard({ entry, kept, onForget }: { entry: LibraryEntry; kept: boolean; onForget?: () => void }) {
  return (
    <div className="group relative flex flex-col gap-2xs">
      <Link
        to={`/${entry.path}`}
        aria-label={entry.title}
        onPointerEnter={() => warm(entry.path)}
        className={cn(
          "relative block h-[102px] cursor-interactive overflow-hidden rounded-lg border border-hairline bg-background dark:border-neutral-400/70",
          "transition-[border-color,translate] duration-(--duration-fast) motion-reduce:transition-none",
          "pointer-hover:border-neutral-300 dark:pointer-hover:border-neutral-400 active:translate-y-px",
          "focus-visible:border-neutral-500 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-500 focus-visible:outline-none",
        )}
      >
        <PagePreview path={entry.path} title={entry.title} />
      </Link>

      {/* The window already names the page, so only the time sits under it,
          on the axis of the text inside the window, with the controls at its end. */}
      <div className="flex h-[22px] items-center justify-between pl-[10px]">
        <span className="text-caption text-neutral-500 tabular-nums">{shortAgo(entry.at)}</span>
      <span className="-mr-[4px] flex items-center opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 has-[:focus-visible]:opacity-100 has-[[aria-pressed=true]]:opacity-100 motion-reduce:transition-none">
        <Hint label={kept ? "Remove the bookmark" : "Bookmark"}>
          <button
            type="button"
            aria-label={kept ? `Remove ${entry.title} from bookmarks` : `Bookmark ${entry.title}`}
            aria-pressed={kept}
            onClick={() => toggleBookmark(entry)}
            className={CONTROL}
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
              className={CONTROL}
            >
              <Icons.dismiss className="size-glyph" />
            </button>
          </Hint>
        )}
      </span>
      </div>
    </div>
  );
}
