/**
 * Where the reader is in their own trail, so the title bar can say whether
 * back and forward lead anywhere.
 *
 * The router moves through the same `window.history` the browser does, and
 * that object tells you nothing: `history.length` counts the whole tab and
 * never shrinks, and there is no "can I go forward" to ask. What it DOES carry
 * is the index the router stamps on every entry it pushes (`history.state.idx`).
 * From the index and the kind of the last move, both answers follow:
 *
 *   - back leads somewhere when the index is past the first entry;
 *   - forward leads somewhere when the index is short of the last one, and the
 *     last one is only known because a PUSH truncates whatever was ahead of it.
 *
 * So the trail's length is tracked here, reset by every push.
 *
 * That is the help pane. The desktop window keeps a trail per tab and knows
 * both answers outright (see lib/tabs).
 */
import { useEffect, useState } from "react";
import { useLocation, useNavigationType } from "react-router";
import { inTauri } from "@/lib/backend";
import { trailOf, useTabs } from "@/lib/tabs";

function currentIndex(): number {
  const state: unknown = window.history.state;
  const idx = (state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : 0;
}

export interface TrailPosition {
  canGoBack: boolean;
  canGoForward: boolean;
}

export const useTrail: () => TrailPosition = inTauri ? useTabTrail : useHistoryTrail;

function useTabTrail(): TrailPosition {
  const { tabs, active } = useTabs();
  return trailOf(tabs[active]);
}

function useHistoryTrail(): TrailPosition {
  const location = useLocation();
  const navigationType = useNavigationType();
  const [trail, setTrail] = useState<TrailPosition>({ canGoBack: false, canGoForward: false });

  useEffect(() => {
    const index = currentIndex();
    setTrail((previous) => {
      // A push throws away everything that was ahead: this entry is the last.
      // Any other move leaves the trail as long as it already was, and the
      // index alone says where in it the reader now stands.
      const length =
        navigationType === "PUSH" ? index + 1 : Math.max(trailLength, index + 1);
      trailLength = length;
      const next = { canGoBack: index > 0, canGoForward: index < length - 1 };
      return next.canGoBack === previous.canGoBack && next.canGoForward === previous.canGoForward
        ? previous
        : next;
    });
  }, [location.key, navigationType]);

  return trail;
}

/* Module state rather than a ref: the trail outlives any one component that
   asks about it, and every window has exactly one trail. */
let trailLength = 1;
