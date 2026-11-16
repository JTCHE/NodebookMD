import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/Hint";
import { Icons } from "@/lib/ui/icons";
import { DISPLAY_TITLE } from "@/lib/ui/type";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

/**
 * One screen of the first launch: a step counter, a title, a line about it,
 * whatever the step asks for, and the key that moves on.
 *
 * Every step is this shape, so a step file states its own words and its own
 * control and nothing about where they sit.
 */
export function StepFrame({
  step,
  title,
  children,
  body,
  media,
  error,
  action,
  busy,
  ready = true,
  onBack,
  onContinue,
}: {
  /** Which of the five steps this is. The welcome screen has none. */
  step?: number;
  /** The heading, as a node so the welcome screen can put the mark in it. */
  title: React.ReactNode;
  body: React.ReactNode;
  /** A picture of what the step is about. It sits above the words, the way a
      first setup shows the thing before it names it. */
  media?: React.ReactNode;
  /** What the step asks for: a list, a switch, nothing. */
  children?: React.ReactNode;
  error?: string;
  /** The word on the key. */
  action: string;
  busy?: boolean;
  /** False while the step still needs an answer. The key dims and stays shut. */
  ready?: boolean;
  onBack?: () => void;
  onContinue: () => void;
}) {
  const key = useRef<HTMLButtonElement>(null);
  // The key takes the focus on every step, and nothing else in the flow takes
  // it away — see the `onMouseDown` guards. So Enter is always "continue",
  // with no key handler of the window's own: the button answers it itself.
  // A disabled key cannot take the focus, so it takes it again once enabled.
  useEffect(() => {
    if (!busy && ready) key.current?.focus();
  }, [step, busy, ready]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-t border-hairline bg-background">
      {step !== undefined && (
        <div className="absolute top-xl left-xl flex items-center gap-ms">
          <Hint label="Back">
          <button
            type="button"
            aria-label="Go back a step"
            disabled={!onBack}
            onClick={onBack}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "grid size-lg place-items-center rounded-md text-neutral-500",
              "cursor-interactive transition-colors duration-(--duration-fast)",
              "pointer-hover:not-disabled:bg-neutral-100 disabled:opacity-0",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              "motion-reduce:transition-none",
            )}
          >
            <Icons.stepBack className="size-md" />
          </button>
          </Hint>
          <span className="text-meta font-medium text-neutral-500">Step {step} of 5</span>
        </div>
      )}

      {/* The 560px column of the design, held to its own height so the key sits
          on the same line on every step and the window never jumps. */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-lg">
        <div className="flex h-[560px] w-full max-w-[560px] flex-col gap-lg">
          <div className="flex min-h-0 flex-1 flex-col justify-center gap-lg">
            {media && (
              <div className="overflow-hidden rounded-lg border border-hairline shadow-pane aspect-[2.4]">{media}</div>
            )}
            <div className="flex flex-col gap-sm">
              <h1 className={DISPLAY_TITLE}>{title}</h1>
              <p className="text-[15.5px] leading-[1.52] tracking-[-0.02em] text-neutral-500">{body}</p>
            </div>
            {children}
          </div>

          <div className="flex flex-col gap-sm">
            {error && <p className="text-meta text-destructive">{error}</p>}
            {/* The key overhangs the column by its own padding, the way every
                surface in this app does, so its label stays on the axis. */}
            <PrimaryButton
              ref={key}
              disabled={busy || !ready}
              onClick={onContinue}
              className={cn("-mx-ms w-auto", !ready && "opacity-40 disabled:cursor-not-allowed")}
            >
              {action}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
