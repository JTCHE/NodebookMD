const INTERACTION = "cursor-interactive transition-colors duration-(--duration-fast) motion-reduce:transition-none ";

export const ROW_INTERACTION = INTERACTION +
  "pointer-hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none";

export const DISCLOSURE_INTERACTION = ROW_INTERACTION + " focus-visible:ring-2 focus-visible:ring-ring/40";
