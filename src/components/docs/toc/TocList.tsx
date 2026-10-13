import type { Heading } from "@/lib/markdown/headings";
import { scrollToHeading } from "./measure";

/**
 * The list itself — one renderer behind the inline list, the sidebar and the
 * pill's panel, so a change to the shape of the TOC lands in all three.
 *
 * Spacing carries the hierarchy: sub-headings sit tight under the section they
 * belong to, and a small gap opens before each new top-level section.
 *
 * Every row's hit area is taller than its visual box (padding plus a
 * compensating negative margin), and a section's leading gap lives inside that
 * row's own padding — no pixel between two rows sits outside every hitbox.
 */
export function TocList({
  headings,
  top,
  active,
  density = "touch",
  padded = false,
  onNavigate,
}: {
  headings: Heading[];
  /** Level of the shallowest heading on the page — depth 0 is measured from it. */
  top: number;
  /** Position of the active heading, not its id — ids repeat. */
  active?: number;
  /** "touch" gives every row a finger-sized hit area; "tight" is for the pointer-driven sidebar. */
  density?: "touch" | "tight";
  /** Rounded hover surface, for the rows inside the pill's panel. */
  padded?: boolean;
  onNavigate?: () => void;
}) {
  const touch = density === "touch";
  // Padding grows the hit area; the negative margin cancels it back out so the
  // rendered list looks the same.
  const rowHit = touch ? "py-1.5 -my-0.5" : "py-1 -my-0.5";
  // The section gap becomes padding inside the first row of a section.
  const sectionGap = "pt-3 -mt-2";

  return (
    <>
      {headings.map((h, i) => {
        const depth = Math.min(h.level - top, 3);
        const startsSection = depth === 0 && i > 0;
        return (
          <a
            key={`${h.id}-${i}`}
            href={`#${h.id}`}
            onClick={(e) => {
              scrollToHeading(e, i, h.id);
              onNavigate?.();
            }}
            aria-current={active === i ? "location" : undefined}
            // Indent is data, and it has to beat the horizontal padding below.
            style={{ paddingLeft: `${(padded ? 0.625 : 0) + depth * 0.75}rem` }}
            className={`block cursor-interactive no-underline leading-snug transition-colors ${
              padded ? "rounded-xl pr-2.5 hover:bg-accent/70" : ""
            } ${depth === 0 ? "text-sm" : "text-[0.8125rem]"} ${rowHit} ${startsSection ? sectionGap : ""} ${
              active === i ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            } ${padded ? "truncate" : ""}`}
          >
            {/* The mark is the colour alone. A bolder weight is wider: a row
                that fits on one line wraps to two when marked, so the list
                either moves or keeps a blank line under the row for it. */}
            {h.text}
          </a>
        );
      })}
    </>
  );
}
