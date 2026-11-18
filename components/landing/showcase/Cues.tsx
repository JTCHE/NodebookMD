"use client";

import { useState } from "react";
import { Keycap } from "@/components/ui/Keycap";
import { cn } from "@/lib/utils";

/** The time the last page took, from the press to its paint, in the empty
    middle of the bar above the page. It stays until the next page. On a phone
    the bar has room for the time only, with no dot. */
export function Opened({ title, ms, size }: { title: string | null; ms: number; size: number }) {
  // Sized with the bar it sits in, so it reads as part of the window.
  return (
    <div
      className="flex animate-in items-center gap-[0.45em] rounded-full border border-hairline bg-background px-[0.75em] py-[0.15em] leading-snug whitespace-nowrap text-muted-foreground shadow-sm duration-200 fade-in zoom-in-95"
      style={{ fontSize: size }}
    >
      {title && (
        <>
          <span className="size-[0.45em] rounded-full bg-brand" />
          <span className="text-foreground">{title}</span> opened in
        </>
      )}
      <span className="font-medium text-brand tabular-nums">{ms} ms</span>
    </div>
  );
}

/** The key the scene presses, in the app's own keycap, over the app. It rises
    and fades in, and fades out when the scene lets go of it; a new key cuts
    the old one short. */
export function KeyCue({ keys }: { keys: string | null }) {
  const [shown, setShown] = useState(keys);
  const [presses, setPresses] = useState(0);
  const [last, setLast] = useState(keys);
  // A new key replaces the one drawn. The same key pressed twice draws twice.
  if (keys !== last) {
    setLast(keys);
    if (keys) {
      setShown(keys);
      setPresses((n) => n + 1);
    }
  }
  if (!shown) return null;
  return (
    <div
      key={presses}
      data-state={keys ? "open" : "closed"}
      onAnimationEnd={() => !keys && setShown(null)}
      className={cn(
        "pointer-events-none absolute bottom-[9%] left-1/2 flex -translate-x-1/2 gap-xs drop-shadow-[0_4px_12px_rgba(0,0,0,0.1)]",
        "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-(--duration-base) data-[state=open]:ease-spring",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:fill-mode-forwards data-[state=closed]:duration-(--duration-base)",
      )}
    >
      {shown.split(" ").map((part) => (
        <Keycap
          key={part}
          className="min-w-9"
        >
          {part}
        </Keycap>
      ))}
    </div>
  );
}
