import { useEffect } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { appWindow } from "@/lib/backend";
import { pastedAnchor, pastedPath } from "@/lib/search";
import { activateTab, current, navigator, openTab, tabsState } from "@/lib/tabs";

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
    and the Rust side has shown the window by then. The page opens in a new
    tab, so the reader keeps the one they were on; a tab on the home page
    has nothing to keep and takes the page itself, and a tab already on the
    page comes to the front, so a launcher that sends the same link twice
    does not stack copies. Once per window: the
    launch link is the window's first page, not where every move leads. */
export function DeepLinks() {
  useEffect(() => {
    if (appWindow()?.label !== "main") return;
    const open = (urls: string[] | null) => {
      if (!urls?.[0]) return;
      const path = linkedPath(urls[0]);
      const { tabs, active } = tabsState();
      const showing = tabs.findIndex((tab) => current(tab).pathname === path.split("#")[0]);
      if (showing >= 0) activateTab(showing);
      else if (current(tabs[active]).pathname === "/") navigator.push(path);
      else openTab(path);
    };
    void getCurrent().then(open, () => {});
    const listening = onOpenUrl(open);
    return () => void listening.then((stop) => stop(), () => {});
  }, []);
  return null;
}
