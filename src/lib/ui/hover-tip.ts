/**
 * When a hover tooltip opens. One rule for every tooltip in the app: the
 * sidebar rows, the links in a page, the icon buttons.
 *
 * The first one waits a moment, so a pointer that only crosses a list or a
 * bar shows nothing. Once one has been open, the next opens at once for a
 * short while, as the system's own tooltips do: the reader is reading them.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** How long the pointer rests before the first tooltip opens. */
const TIP_DELAY = 400;
/** How long after a tooltip closes the next one still opens at once. */
const TIP_WARM = 800;
/** Until when a tooltip opens with no wait. Shared by all of them. */
let warmUntil = 0;

export function useHoverTip() {
  const [shown, setShown] = useState(false);
  const wait = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(wait.current), []);

  /** The pointer arrived: open after the wait, or at once while warm. */
  const open = useCallback(() => {
    clearTimeout(wait.current);
    if (Date.now() < warmUntil) setShown(true);
    else wait.current = setTimeout(() => setShown(true), TIP_DELAY);
  }, []);

  /** Keyboard focus: the reader asked for this one, so no wait. */
  const openNow = useCallback(() => {
    clearTimeout(wait.current);
    setShown(true);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(wait.current);
    setShown((was) => {
      if (was) warmUntil = Date.now() + TIP_WARM;
      return false;
    });
  }, []);

  return { shown, open, openNow, hide };
}
