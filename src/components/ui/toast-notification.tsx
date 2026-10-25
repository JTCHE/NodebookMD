import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

export type ToastType = "error" | "info";

interface ToastProps {
  message: string;
  type: ToastType;
}

// Pure visual component — safe to render anywhere at root level.
//
// It sits below the sticky header — level with the breadcrumbs, not on top of
// the search field — and fades in with a slight scale and blur, back out the
// same way when it goes.
export function ToastNotification({ message, type, visible }: { message: string; type: ToastType; visible: boolean }) {
  return (
    // px only — inline style: the comma inside an arbitrary value stops the
    // class from ever being generated.
    <div
      style={{ top: "calc(var(--header-h, 3.5rem) + 0.5rem)" }}
      className="fixed inset-x-0 z-100 flex justify-center pointer-events-none"
    >
      <div
        className={`text-sm px-4 py-2 shadow-lg pointer-events-auto rounded transition-[opacity,transform,filter] duration-200 ease-out motion-reduce:transition-none ${
          visible ? "opacity-100 scale-100 blur-0" : "opacity-0 scale-95 blur-sm"
        } ${type === "info" ? "bg-muted text-foreground border border-border" : "bg-foreground text-background"}`}
      >
        {message}
      </div>
    </div>
  );
}

// Fire from anywhere — no React tree constraints.
export function showToast(message: string, type: ToastType = "info") {
  window.dispatchEvent(new CustomEvent("nodebookmd:toast", { detail: { message, type } }));
}

// Mount once at root — listens for showToast() calls and renders the toast.
// The listener keeps the last message mounted for the exit transition, then
// unmounts it for real.
export function ToastListener() {
  const [toast, setToast] = useState<ToastProps | null>(null);
  const [visible, setVisible] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // A toast belongs to the page it fired on. Navigating away dismisses it at
  // once.
  const { pathname } = useLocation();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    setVisible(false);
    setToast(null);
  }, [pathname]);

  useEffect(() => {
    function onToast(e: Event) {
      const { message, type } = (e as CustomEvent<ToastProps>).detail;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
      setToast({ message, type });
      setVisible(true);
      // Out after 4s; unmount one frame past the exit transition (200ms).
      timers.current.push(setTimeout(() => setVisible(false), 4000));
      timers.current.push(setTimeout(() => setToast(null), 4220));
    }
    window.addEventListener("nodebookmd:toast", onToast);
    return () => {
      window.removeEventListener("nodebookmd:toast", onToast);
      for (const timer of timers.current) clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;
  return <ToastNotification message={toast.message} type={toast.type} visible={visible} />;
}
