import { MarkdownActions } from "@/components/docs/MarkdownActions";
import { BookmarkButton } from "@/components/docs/BookmarkButton";
import { ExampleFor, LaunchExample } from "@/components/docs/LaunchExample";
import type { LibraryEntry } from "@/lib/store/library";
import { PageTitle } from "@/components/docs/PageTitle";
import { NodeVersionSelector } from "@/components/docs/NodeVersionSelector";
import type { NodeVersion } from "@/lib/pages";
import type { Root } from "hast";
import { PicturesButton } from "@/components/docs/PicturesButton";

interface PageHeaderProps {
  /** Page name, left exactly as written in the help source. */
  name: string;
  /** Page kind (e.g. "geometry node"), Title Cased for display and given a
   *  lighter visual weight so it reads as a qualifier, not part of the name. */
  nodeType?: string;
  icon?: string;
  since?: string;
  summary?: string;
  /** The page as Markdown, for the copy button. */
  markdown: string;
  /** The page itself, for the bookmark control. */
  entry: Omit<LibraryEntry, "at">;
  /** Every version of this node, newest first. */
  versions: NodeVersion[];
  /** The page body, for the pictures button. */
  tree?: Root;
}

/** Single source of truth for a docs page's header row: icon, name + type,
 *  the "Since" badge, the copy-as-markdown action, and the summary caption. */
export function PageHeader({ name, nodeType, icon, since, summary, markdown, entry, versions, tree }: PageHeaderProps) {
  return (
    <header className="@container not-prose mb-4">
      {/* The actions hold the right of the title line at every width. What
          wraps is the title side: a long name wraps under itself. */}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-0 flex-wrap items-center gap-x-3 gap-y-2">
          <PageTitle name={name} nodeType={nodeType} icon={icon} />
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5 print:hidden">
          <ExampleFor path={entry.path} />
          <LaunchExample path={entry.path} />
          {tree && <PicturesButton tree={tree} />}
          <BookmarkButton entry={entry} />
          <MarkdownActions markdown={markdown} path={entry.path} title={name} />
        </div>
        {/* The summary and the pills share one row, which the pills would
            otherwise take for themselves under the title. The pills keep the
            right of the row and go under a summary too long to leave them
            room. The version sits beside Since: both say which node this is. */}
        {(summary || since || versions.length > 1) && (
          <div className="flex w-full basis-full flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            {summary && <p className="m-0 min-w-0 flex-1 text-sm italic text-muted-foreground">{summary}</p>}
            <div className="flex shrink-0 items-center gap-2">
              <NodeVersionSelector versions={versions} path={entry.path} />
              {since && (
                <span className="shrink-0 text-xs text-neutral-500">
                  Since {since}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
