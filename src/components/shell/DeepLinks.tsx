import { useEffect } from "react";
import { useNavigate } from "react-router";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { appWindow } from "@/lib/backend";
import { pastedAnchor, pastedPath } from "@/lib/search";

/** The page a `<scheme>://docs/<slug>` link names. The link comes from the
    notice on the site, and its slug is the site's old address,
    `houdini/nodes/sop/box`. A slug with no page under it is the home page. */
export function linkedPath(link: string): string {
  const slug = link.replace(/^[a-z][\w+.-]*:\/\/docs\/?/i, "");
  return slug ? `/${pastedPath(`/docs/${slug}`)}${pastedAnchor(link)}` : "/";
}

/** Opens the page a link names, in the first window only: a window opened
    later (Ctrl N) has a page of its own. The link that started the app is
    read once at mount; a link that comes while it runs arrives as an event,
    and the Rust side has shown the window by then. */
export function DeepLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (appWindow()?.label !== "main") return;
    const open = (urls: string[] | null) => {
      if (urls?.[0]) navigate(linkedPath(urls[0]));
    };
    void getCurrent().then(open, () => {});
    const listening = onOpenUrl(open);
    return () => void listening.then((stop) => stop(), () => {});
  }, [navigate]);
  return null;
}
