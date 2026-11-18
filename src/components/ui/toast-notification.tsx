import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { TOOLTIP_SURFACE } from "@/lib/ui/tooltip";

/** One toast, in the tooltip style. It sits under the title bar, level with
    the breadcrumbs, and fades in and out. */
function ToastNotification({ message, visible }: { message: string; visible: boolean }) {
  return (
    <div style={{ top: "calc(var(--spacing-titlebar) + 0.5rem)" }} className="fixed inset-x-0 z-100 flex justify-center pointer-events-none">
      <div
        className={cn(
          TOOLTIP_SURFACE,
          "max-w-[min(36rem,calc(100vw-2rem))] rounded-[11px] px-sm py-xs font-medium text-foreground [corner-shape:squircle] pointer-events-auto transition-opacity duration-200 ease-out motion-reduce:transition-none",
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        {message}
      </div>
    </div>
  );
}

/** Fire from anywhere: no React tree constraints. */
export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent("nodebookmd:toast", { detail: message }));
}

/** Mount once at root. Keeps the last message mounted for the exit fade, then
    unmounts it. */
export function ToastListener() {
  const [message, setMessage] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // A toast belongs to the page it fired on. Navigating away dismisses it at once.
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    setVisible(false);
    setMessage(null);
  }, [pathname]);

  useEffect(() => {
    function onToast(event: Event) {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
      setMessage((event as CustomEvent<string>).detail);
      setVisible(true);
      // Out after 4s; unmount one frame past the exit fade (200ms).
      timers.current.push(setTimeout(() => setVisible(false), 4000));
      timers.current.push(setTimeout(() => setMessage(null), 4220));
    }
    window.addEventListener("nodebookmd:toast", onToast);
    return () => {
      window.removeEventListener("nodebookmd:toast", onToast);
      for (const timer of timers.current) clearTimeout(timer);
    };
  }, []);

  if (!message) return null;
  return <ToastNotification message={message} visible={visible} />;
}
