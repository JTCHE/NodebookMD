/**
 * The page header's controls: copy, bookmark, pictures, launch, and the link
 * from an example to its node. One height, one padding, one type size, so a
 * row of them reads as one set whether a control is quiet or primary.
 */
export const ACTION = "flex h-8 shrink-0 cursor-interactive items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium [corner-shape:squircle]";

/** The quiet look most of them take. The primary one is `PrimaryButton`. */
export const QUIET =
  "text-muted-foreground transition-colors " +
  "hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400 focus-visible:outline-none";

export const ACTION_ICON = "size-4 shrink-0";

/* A square icon button on the bar. Smaller than a caption button and rounded,
   because it belongs to the app rather than to the window.
   The find bar uses it too. */
export const BAR_BUTTON =
  "grid size-[28px] shrink-0 cursor-interactive place-items-center rounded-md text-neutral-700 " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:not-disabled:bg-neutral-200 active:not-disabled:bg-neutral-300 " +
  "disabled:text-neutral-400 disabled:pointer-events-none " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** A text action that reads as a link: the brand ink, a rule under the
    pointer, and a dim while it is pressed. */
export const TEXT_LINK =
  "cursor-interactive rounded-sm text-brand-700 underline-offset-2 transition-opacity duration-(--duration-fast) motion-reduce:transition-none " +
  "pointer-hover:underline active:opacity-60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
