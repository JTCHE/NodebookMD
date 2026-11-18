/**
 * The accent choices in Settings: one round swatch for each. A fixed accent
 * is split on its diagonal into the accent and the accent as text, the two
 * steps a page uses. Custom is the colour wheel: it opens a hue slider in a
 * small panel under it, so the row does not move.
 */
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { MENU_SURFACE } from "@/lib/ui/menu";
import { ACCENTS, ACCENT_LABEL, hueOf, setAccent, setHue, type Accent } from "@/lib/ui/accent";

/** All the hues, for the custom swatch and the hue slider's track. */
export const HUE_WHEEL = Array.from({ length: 13 }, (_, step) => `oklch(0.68 0.17 ${step * 30})`).join(", ");

function swatch(accent: Accent, hue: number): string {
  if (accent === "custom") return `conic-gradient(${HUE_WHEEL})`;
  // Original: its greys and the trademark orange. Monochrome: white and black.
  if (accent === "original") return "linear-gradient(135deg, oklch(0.68 0 0) 50%, oklch(0.68 0.174 52) 50%)";
  if (accent === "monochrome") return "linear-gradient(135deg, oklch(0.97 0 0) 50%, oklch(0.2 0 0) 50%)";
  const strength = 1;
  const shade = hueOf(accent, hue);
  return `linear-gradient(135deg, oklch(0.68 ${0.174 * strength} ${shade}) 50%, oklch(0.575 ${0.147 * strength} ${shade}) 50%)`;
}

export function AccentPicker({ value, hue }: { value: Accent; hue: number }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // The panel closes on a press outside the picker, and on Escape.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const choose = (accent: Accent) => {
    setAccent(accent);
    setOpen(accent === "custom" ? !(open && value === "custom") : false);
  };

  return (
    <div ref={root} role="radiogroup" aria-label="Accent" className="relative flex items-center gap-sm pr-[3.5px]">
      {ACCENTS.map((accent) => (
        <button
          key={accent}
          type="button"
          role="radio"
          aria-checked={value === accent}
          aria-label={ACCENT_LABEL[accent]}
          aria-expanded={accent === "custom" ? open : undefined}
          title={ACCENT_LABEL[accent]}
          onClick={() => choose(accent)}
          className={cn(
            "size-5 shrink-0 cursor-interactive rounded-full ring-1 ring-foreground/10 ring-inset pointer-hover:ring-foreground/30",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            // The chosen swatch keeps its full size, with a ring outside it.
            // A shadow, so the focus outline can still draw over it.
            value === accent && "shadow-[0_0_0_2px_var(--background),0_0_0_3.5px_var(--neutral-600)]",
          )}
          style={{ background: swatch(accent, hue) }}
        />
      ))}
      {open && value === "custom" && (
        // It grows out of the custom swatch. While the knob is held, Settings
        // steps aside and only this panel stays, as for the page width.
        <div
          data-preview-keep
          className={cn(
            MENU_SURFACE.replace("pop-in", ""),
            "grow-in absolute top-full right-0 z-30 mt-sm flex origin-[calc(100%-13.5px)_-14px] items-center gap-sm px-ms py-sm",
          )}
        >
          <span
            aria-hidden
            className="size-4 shrink-0 rounded-full ring-1 ring-foreground/10 ring-inset"
            style={{ background: `oklch(0.68 0.174 ${hue})` }}
          />
          <input
            type="range"
            aria-label="Hue"
            autoFocus
            className="slider slider-hue w-[160px]"
            style={{ "--hue-wheel": `linear-gradient(to right, ${HUE_WHEEL})` } as React.CSSProperties}
            min={0}
            max={360}
            value={hue}
            onChange={(event) => setHue(Number(event.target.value))}
            onPointerDown={() => (document.documentElement.dataset.previewing = "")}
            onPointerUp={() => delete document.documentElement.dataset.previewing}
            onLostPointerCapture={() => delete document.documentElement.dataset.previewing}
          />
        </div>
      )}
    </div>
  );
}
