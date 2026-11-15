/**
 * One remembered page, drawn as a small window onto the page itself. The
 * bookmark and remove controls float on it in a pill, under the pointer.
 */
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/Hint";
import { Icons } from "@/lib/ui/icons";
import { toggleBookmark, type LibraryEntry } from "@/lib/store/library";
import { warm } from "@/lib/pages";
import { PagePreview } from "@/components/root/PagePreview";

const CONTROL =
  "grid size-[22px] cursor-interactive place-items-center rounded-md text-neutral-500 " +
  "transition-[opacity,background-color,color] duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:bg-foreground/[0.06] pointer-hover:text-neutral-900 active:bg-foreground/[0.1] " +
  "focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none";

export function LibraryCard({ entry, kept, onForget }: { entry: LibraryEntry; kept: boolean; onForget?: () => void }) {
  return (
    <div className="group relative snap-start">
      <Link
        to={`/${entry.path}`}
        aria-label={entry.title}
        onPointerEnter={() => warm(entry.path)}
        className={cn(
          // Open at the foot: the page fades out as if it goes on under the window.
          "fade-out relative block h-[118px] cursor-interactive overflow-hidden rounded-lg border-[0.5px] border-hairline bg-background [--fade-size:32px]",
          "transition-[border-color,translate] duration-(--duration-fast) motion-reduce:transition-none",
          "pointer-hover:border-neutral-300 active:translate-y-px dark:bg-neutral-100",
          "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none",
        )}
      >
        <PagePreview path={entry.path} title={entry.title} />
      </Link>

      <span className="absolute top-[6px] right-[6px] flex items-center gap-[2px] rounded-md bg-background p-[2px] shadow-chip opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 has-[:focus-visible]:opacity-100 motion-reduce:transition-none dark:bg-neutral-200">
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
  );
}
