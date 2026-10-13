/**
 * One row of the sidebar. There is only one.
 *
 * A group header, a node context, a page and the Recents row are the same
 * object at different depths: the same height, the same padding, the same
 * arrow slot, the same mark slot, the same number on the right. Anything a
 * caller wants to change is a prop, never a second set of numbers — two row
 * shapes is what made the panel read as several components stacked up.
 *
 * State is carried by COLOUR, not by weight. A row that goes bold when it is
 * selected re-flows its own text and shifts everything beside it, so the ramp
 * is: quiet when idle, brighter under the pointer, and settled in between when
 * it is the row you are on. Only a group header is bold, and it is bold in
 * every state.
 */
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { warm } from "@/lib/pages";
import { Icons } from "@/lib/ui/icons";
import DocIconClient from "@/components/docs/markdown/DocIconClient";
import { useRowTip } from "@/components/docs/Tooltip";

/** `back` is the row that leaves a branch: the arrow points the other way and
    the row reads as the level above, not as a thing to open. */
export type RowDisclosure = "expanded" | "collapsed" | "back" | "none";

export interface SidebarRowProps {
  label: string;
  /** Icon path inside `icons.zip`. Without one the row draws the page mark.
      Leave it off entirely for a row that carries no mark at all. */
  icon?: string | null;
  /** A mark drawn by the app rather than read from the help — the group
      glyphs, a clock. Takes the icon slot, so both cannot be given. `null`
      holds the slot open and draws nothing, for a row that carries no mark but
      still has to keep its name on the axis of the rows around it. */
  mark?: React.ReactNode;
  disclosure?: RowDisclosure;
  /** Draw the arrow only under the pointer. A branch row inside an open group
      already reads as a thing to open from its place in the list, and twenty
      arrows down the left of the panel are a column of noise. */
  quietDisclosure?: boolean;
  /** Shown right-aligned: how many pages are under this row. */
  count?: number;
  selected?: boolean;
  /** A group header — bold in every state, because it names a place. */
  header?: boolean;
  /** A header whose branch is open. Draws the raised chip, the same one a
      selected page row draws. */
  active?: boolean;
  onClick?: () => void;
  /** A kept page, marked where it is read from. The flag hangs off the left
      of the row rather than taking a column, so the marks of kept and unkept
      pages stay on one axis. */
  kept?: boolean;
  /** An app path, for a row that opens a page. A row with one is a link and
      not a button, so it drags, opens in place, and reads as a destination. */
  to?: string;
  className?: string;
  /** For the one thing a class cannot state: an indent worked out from depth. */
  style?: React.CSSProperties;
  /** A row outside the tree, as in Settings: no arrow or flag slot, so its
      mark stands on the axis of the title above the list. */
  bare?: boolean;
}

export function SidebarRow({
  label,
  icon,
  mark,
  disclosure = "none",
  quietDisclosure = false,
  count,
  kept = false,
  selected = false,
  header = false,
  active = false,
  onClick,
  to,
  className,
  style,
  bare = false,
}: SidebarRowProps) {
  const Disclosure =
    disclosure === "expanded" ? Icons.expanded : disclosure === "back" ? Icons.back : Icons.collapsed;
  // What stands in where the help ships no icon. A row that opens holds pages,
  // so the page glyph would say the row IS a page.
  const Stand = disclosure === "expanded" || disclosure === "collapsed" ? Icons.section : Icons.page;
  const raised = selected || active;
  // A page row names its page the way a link in the page does: the panel
  // cuts long names short, and the tooltip gives the whole name and what the
  // page is about.
  const { anchorRef, pointer, tip } = useRowTip<HTMLAnchorElement>((to ?? "").replace(/^\/+/, ""), "right");

  // A row is a link when it names a page and a button when it opens a branch.
  // The two take different props, so the shared part is the class and the
  // children, and only the element around them changes.
  const shared = {
    "aria-expanded":
      disclosure === "expanded" || disclosure === "collapsed" ? disclosure === "expanded" : undefined,
    "aria-current": selected ? ("page" as const) : undefined,
    style,
    className: cn(
      // shrink-0: a row sits in flex lists of both kinds — the windowed tree,
      // and a plain flex column (Recents) that can hold more rows than its own
      // max-height. Flexbox shrinks a child below its stated height to fit a
      // box like that unless told not to, which is what squeezed every Recents
      // row down to its text's own line-height.
      "relative flex h-row w-full shrink-0 cursor-interactive items-center gap-sm rounded-md px-sm text-left",
      "transition-colors duration-(--duration-fast) motion-reduce:transition-none",
      // The row you are on is a chip lifted off the panel, not a tinted band:
      // the panel is already a shade of the page, so a tint would have to be
      // darker than the page to read at all.
      raised ? "bg-raised shadow-chip" : "pointer-hover:bg-raised/70",
      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      className,
    ),
  };

  const content = (
    <>
      {bare ? null : disclosure === "none" ? (
        // A page row has no arrow, so the arrow's place is where its flag
        // goes. Outside the row the flag hung into the panel's own margin and
        // read as a stray mark; here it reads as the row's own state, and an
        // unkept page still holds the width open so nothing shifts when a
        // page is kept.
        <span className="grid size-[11px] shrink-0 place-items-center" aria-hidden="true">
          {kept && <Icons.bookmark className="size-[9px] text-brand" fill="currentColor" />}
        </span>
      ) : (
        <Disclosure
          className={cn(
            "size-[11px] shrink-0",
            // Open reads as a darker arrow, not as the raised chip: the chip
            // means "the row you are on", and an open branch is a place you
            // are inside, not the row itself.
            disclosure === "expanded" ? "text-neutral-600" : "text-neutral-400",
            quietDisclosure &&
              "opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 motion-reduce:transition-none",
          )}
        />
      )}

      {/* The mark sits in a box of a stated size whatever fills it. A help
          icon carries its own aspect ratio and an app glyph does not, and
          without the box the two draw rows of different heights. */}
      {(mark !== undefined || icon !== undefined) && (
        <span className="grid size-[15px] shrink-0 place-items-center" aria-hidden="true">
          {mark === undefined && icon !== undefined ? (
            icon ? (
              <DocIconClient
                src={icon}
                alt=""
                className="size-[15px]"
                // The list only mounts the rows on screen, so a lazy load only
                // adds a frame between a row and its icon.
                priority
                // The install ships a few pages whose icon file is not in it.
                // A blank where every neighbour has a mark reads as a fault;
                // the page glyph reads as a page.
                fallback={<Stand className="size-[15px] text-neutral-400" />}
              />
            ) : (
              <Stand className="size-[15px] text-neutral-400" />
            )
          ) : (
            mark
          )}
        </span>
      )}

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px] tracking-[-0.01em]",
          header && "font-medium",
          raised ? "text-neutral-800" : "text-neutral-500 group-hover:text-neutral-900",
        )}
      >
        {label}
      </span>

      {count !== undefined && (
        <span className="shrink-0 text-[11.5px] text-neutral-400 tabular-nums">
          {count.toLocaleString()}
        </span>
      )}
    </>
  );

  return to ? (
    // The read starts when the pointer arrives, not when the button goes
    // down: the trip from one row to the next is longer than the read.
    <>
    <Link
      ref={anchorRef}
      to={to}
      {...pointer}
      onPointerEnter={() => {
        warm(to.replace(/^\/+/, ""));
        pointer.onPointerEnter();
      }}
      // The row goes on the press like every other control, and the rule that
      // makes it so is one listener — see lib/ui/press. Nothing to wire here.
      onClick={() => onClick?.()}
      {...shared}
      className={cn("group", shared.className)}
    >
      {content}
    </Link>
    {tip}
    </>
  ) : (
    <button
      type="button"
      onClick={() => onClick?.()}
      {...shared}
      className={cn("group", shared.className)}
    >
      {content}
    </button>
  );
}
