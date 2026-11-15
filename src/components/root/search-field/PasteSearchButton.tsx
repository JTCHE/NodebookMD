import { PrimaryButton } from "@/components/ui/PrimaryButton";

/**
 * The one control beside the search input.
 *
 * It knows nothing about searching. In "paste" mode it asks its owner to fill
 * the field from the clipboard; in "search" mode it is the form's submit
 * button and the form does the rest. The surface it wears is
 * `PrimaryButton` — the same key the onboarding steps end with.
 */
export function PasteSearchButton({
  mode,
  label,
  disabled,
  onPaste,
  className,
}: {
  /** "paste" reads the clipboard first; "search" submits what is already typed. */
  mode: "paste" | "search";
  label: string;
  disabled?: boolean;
  onPaste: () => void;
  className?: string;
}) {
  return (
    <PrimaryButton
      type={mode === "paste" ? "button" : "submit"}
      onClick={mode === "paste" ? onPaste : undefined}
      disabled={disabled}
      className={className}
    >
      {label}
    </PrimaryButton>
  );
}
