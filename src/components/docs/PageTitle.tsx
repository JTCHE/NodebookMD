import { toTitleCase } from "@/lib/markdown/page-title";
import DocIconClient from "@/components/docs/markdown/DocIconClient";
import { openPicture } from "@/lib/lightbox";
import { localIconUrl } from "@/lib/icons";

interface PageTitleProps {
  name: string;
  nodeType?: string;
  icon?: string;
}

/**
 * Name and type share a line when they fit and stack when they do not — the
 * same rule the OG image applies. The separator is a bar in the flex gap, half
 * a gap left of the type. A type that wraps starts at the content edge, which
 * puts its bar outside the clip, so the bar disappears with the line break.
 * No measurement, no state, and no layout shift.
 */
export function PageTitle({ name, nodeType, icon }: PageTitleProps) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      {/* No stand-in here. A list needs one, because a blank in a column of
          marks reads as a fault; a title stands alone, and a generic glyph in
          front of it only says the page has no icon. */}
      {/* Pressed, the icon opens large; its right-click menu copies its
          name and its SVG (ContextMenu). */}
      {icon && (
        <button
          type="button"
          aria-label={`Show the ${name} icon`}
          data-icon={icon}
          onClick={(event) => openPicture(event.currentTarget, { src: localIconUrl(icon), alt: `${name} icon`, icon, ground: "none" })}
          className="-m-1 shrink-0 cursor-zoom-in rounded-md p-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <DocIconClient src={icon} alt="" className="size-8 select-none" priority />
        </button>
      )}
      <div className="min-w-0 overflow-hidden">
        <h1 className="flex flex-wrap items-baseline gap-x-4 m-0 text-2xl font-bold tracking-tight leading-tight">
          <span className="min-w-0 wrap-break-word">{name}</span>
          {nodeType && (
            <span className="relative font-extralight text-muted-foreground before:absolute before:top-1/2 before:-left-2 before:h-6 before:w-px before:-translate-y-1/2 before:bg-border">
              {toTitleCase(nodeType)}
            </span>
          )}
        </h1>
      </div>
    </div>
  );
}
