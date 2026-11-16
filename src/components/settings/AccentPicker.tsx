/**
 * The accent choices in Settings: one round swatch for each. A fixed accent
 * is split on its diagonal into the accent and the accent as text, the two
 * steps a page uses. Custom is the colour wheel, and opens a hue slider.
 */
import { cn } from "@/lib/utils";
import { ACCENTS, ACCENT_LABEL, hueOf, setAccent, type Accent } from "@/lib/ui/accent";

/** All the hues, for the custom swatch and the hue slider's track. */
export const HUE_WHEEL = Array.from({ length: 13 }, (_, step) => `oklch(0.68 0.17 ${step * 30})`).join(", ");

function swatch(accent: Accent, hue: number): string {
  if (accent === "custom") return `conic-gradient(${HUE_WHEEL})`;
  const strength = accent === "neutral" ? 0 : 1;
  const shade = hueOf(accent, hue);
  return `linear-gradient(135deg, oklch(0.68 ${0.174 * strength} ${shade}) 50%, oklch(0.575 ${0.147 * strength} ${shade}) 50%)`;
}

export function AccentPicker({ value, hue }: { value: Accent; hue: number }) {
  return (
    <div role="radiogroup" aria-label="Accent" className="flex items-center gap-sm">
      {ACCENTS.map((accent) => (
        <button
          key={accent}
          type="button"
          role="radio"
          aria-checked={value === accent}
          aria-label={ACCENT_LABEL[accent]}
          title={ACCENT_LABEL[accent]}
          onClick={() => setAccent(accent)}
          className={cn(
            "size-5 shrink-0 cursor-interactive rounded-full ring-1 ring-foreground/10 ring-inset",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // The chosen swatch has a ring of the ink, apart from its colour
            // by the ground's. Both are inside the swatch, so the last one
            // ends on the content's right edge, as the controls above do.
            value === accent && "shadow-[inset_0_0_0_2px_var(--foreground),inset_0_0_0_4px_var(--background)]",
          )}
          style={{ background: swatch(accent, hue) }}
        />
      ))}
    </div>
  );
}
