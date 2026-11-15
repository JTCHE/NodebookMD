/**
 * What a cold window opens onto instead of an empty Recents list.
 *
 * Three columns from the design. Nodes and Languages point at real branches
 * of the mirrored docs, the same way the sidebar tree does: a context's own
 * overview page sits at `<section>/<context>/index`, the way
 * `lib/landing/tree.ts` already assumes when it drops a hit ending in
 * `/index` from a branch's row list.
 *
 * Start here is the design's five rows, cut to the two the app can honestly
 * answer:
 *   - "Adding custom HDA docs" opens the mirrored SideFX page on writing an
 *     asset's own help (`help/nodes` — SideFX titles it "Documenting your
 *     assets").
 *   - "Set up the MCP" opens the Houdini MCP repo the README already points
 *     readers at. An external link is still an honest destination, the same
 *     way the reading view's own "SideFX" link opens the source in the
 *     reader's browser.
 * The other three have no honest destination and are left out rather than
 * wired to nothing:
 *   - "Set the app as F1 help" — the app has no command or settings screen
 *     that sets itself as Houdini's help target; `help.rs` only reads help
 *     pages out of an install, it does not register one.
 *   - "Keyboard shortcuts" — the mirrored docs page with this title
 *     (`basics/hotkeys`, "Configuring hotkeys") teaches Houdini's own hotkey
 *     editor, not this app's shortcuts, so it would answer a different
 *     question than the row asks. The app states its own shortcuts in the
 *     status bar, not on a page of its own.
 *   - "How to pin pages" — the act is a feature of this app (`toggleBookmark`
 *     in `lib/store/library.ts`, called "Bookmark" everywhere else in the
 *     UI), not a topic the mirrored SideFX docs cover, and the app has no
 *     help screen of its own to send the row to.
 */
import { Fragment } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { Icons, type IconComponent } from "@/lib/ui/icons";
import { warm } from "@/lib/pages";
import { WINDOW } from "@/components/root/LibraryCard";

interface ColumnRow {
  label: string;
  /** An app path, opened in the window. Exactly one of `path`/`href` is set. */
  path?: string;
  /** An external address, opened in the reader's browser. */
  href?: string;
}

interface Column {
  id: string;
  label: string;
  icon: IconComponent;
  rows: ColumnRow[];
}

const COLUMNS: Column[] = [
  {
    id: "start",
    label: "Start here",
    // No dedicated glyph ships for this column; Learn's own book icon is the
    // closest honest shape lucide already gives the app for "read this".
    icon: Icons.groupLearn,
    rows: [
      { label: "Set up the MCP", href: "https://github.com/JTCHE/houdini-mcp" },
      { label: "Adding custom HDA docs", path: "help/nodes" },
    ],
  },
  {
    id: "nodes",
    label: "Nodes",
    icon: Icons.groupNodes,
    rows: [
      { label: "Geometry — SOP", path: "nodes/sop/index" },
      { label: "Solaris — LOP", path: "nodes/lop/index" },
      { label: "Dynamics — DOP", path: "nodes/dop/index" },
      { label: "Materials — VOP", path: "nodes/vop/index" },
      // The design calls this row "Compositing — COP". Copernicus is the
      // context that actually carries the plain "COP" acronym — the older
      // network is COP2, labelled "Compositing — COP2" everywhere else in
      // the app — so the row is named for the page it actually opens.
      { label: "Copernicus — COP", path: "nodes/cop/index" },
    ],
  },
  {
    id: "languages",
    label: "Languages",
    icon: Icons.groupLanguages,
    rows: [
      { label: "VEX functions", path: "vex/functions/index" },
      { label: "Python — HOM", path: "hom/index" },
      { label: "Expressions", path: "expressions/index" },
      // The design's "Attributes" row names no section or branch this app's
      // tree knows about (see GROUPS in lib/landing/tree.ts) — left out
      // rather than guessed at.
      { label: "HScript commands", path: "commands/index" },
    ],
  },
];

export function ExploreColumns({ className }: { className?: string }) {
  return (
    // Three windows, in the surface the recents use, out like the search
    // field so the text inside sits on its text axis.
    <div className={cn("-mr-xs -ml-ms grid grid-cols-3 items-start gap-sm lg:-ml-md", className)}>
      {COLUMNS.map((column) => {
        const Mark = column.icon;
        return (
          <Fragment key={column.id}>
            <div className={cn(WINDOW, "flex min-w-0 flex-col gap-xs p-ms lg:p-md")}>
              <div className="flex h-[20px] items-center gap-sm">
                <Mark className="size-icon shrink-0 text-neutral-500" />
                <span className="text-label font-medium tracking-[-0.012em] text-neutral-950">
                  {column.label}
                </span>
              </div>

              {/* Same overhang as every other row in the panel: the row
                  carries the padding, the list cancels it, so the text lands
                  on the column's own edge and only the hover plate reaches
                  past it. */}
              <div className="-mx-sm flex flex-col">
                {column.rows.map((row) => {
                  const rowClass = cn(
                    "flex h-[30px] items-center rounded-md px-sm text-label tracking-[-0.01em] text-neutral-700 [corner-shape:squircle] ",
                    "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
                    "pointer-hover:bg-foreground/[0.04] pointer-hover:text-neutral-950",
                    "focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none",
                  );
                  // An external row opens in the reader's browser, the same
                  // way the reading view's own "SideFX" link does — this
                  // window is not where a GitHub repo belongs.
                  if (row.href) {
                    return (
                      <a
                        key={row.href}
                        href={row.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={rowClass}
                      >
                        {row.label}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={row.path}
                      to={`/${row.path}`}
                      onPointerEnter={() => warm(row.path!)}
                      className={rowClass}
                    >
                      {row.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
