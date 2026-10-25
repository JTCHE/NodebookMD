/**
 * The right-click menu, drawn by the app.
 *
 * The webview's own menu is a browser's — reload, inspect, save the app's
 * HTML shell — and reads as a web page inside the window. This one holds what
 * the reader can do where they pressed: a link, a picture, a selection, the
 * page. A field the reader types in keeps the webview's menu, because cut,
 * copy and paste live there. In a development build Shift keeps it too, for
 * Inspect.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AppWindow, ArrowLeft, ArrowRight, Code, Copy, Download, ExternalLink, Image, ImageDown, Link2, ListTree, Plus, Tag } from "lucide-react";
import { revealInSidebar } from "@/components/shell/sidebar/PageTree";
import { MenuList, type MenuEntry, type MenuGroups } from "@/components/ui/MenuList";
import { useTrail } from "@/lib/nav";
import { pageActions } from "@/lib/page-actions";
import { pageLink } from "@/lib/link";
import { openTab } from "@/lib/tabs";
import { copyIconPng, houdiniIconName, iconSvg, saveIcon } from "@/lib/icons";
import { BACK_KEYS, COMMAND_KEY, FORWARD_KEYS } from "@/lib/hotkeys";
import { invoke, inTauri } from "@/lib/backend";
import { openLightbox, PAGE_PICTURES } from "@/lib/lightbox";
import { showToast } from "@/components/ui/toast-notification";
import { copyPicture } from "@/lib/pictures";
import { used } from "@/lib/telemetry";

/** The address of a link the app draws: a page of the app as Settings
    names it, anything else as it is. */
function shareable(href: string): Promise<string> {
  const url = new URL(href, location.href);
  return url.origin === location.origin ? pageLink(url.pathname.slice(1), url.hash) : Promise.resolve(url.href);
}

async function copyText(text: string, said: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(said);
  } catch {
    showToast("Couldn't copy", "error");
  }
}

/** What can be done with a help icon's file. In the lightbox, Ctrl+C and
    Ctrl+S run these (Lightbox), so the menu names the keys there only. */
export function iconFileEntries(source: string, keyed: boolean): MenuEntry[] {
  const entries: MenuEntry[] = [
    { label: "Copy as SVG", icon: Code, run: () => iconSvg(source).then((svg) => copyText(svg, "SVG copied")) },
    {
      label: "Copy as PNG",
      icon: ImageDown,
      keys: keyed ? `${COMMAND_KEY}+C` : undefined,
      run: () => copyIconPng(source).then(() => showToast("PNG copied"), () => showToast("Couldn't copy", "error")),
    },
  ];
  // The help pane has no dialog to ask where.
  if (inTauri) {
    entries.push({
      label: "Save as…",
      icon: Download,
      keys: keyed ? `${COMMAND_KEY}+S` : undefined,
      run: () => saveIcon(source).then((saved) => saved && showToast("Icon saved"), (reason) => showToast(String(reason), "error")),
    });
  }
  return entries;
}

export function ContextMenu() {
  const [at, setAt] = useState<{ x: number; y: number; menu: MenuGroups } | null>(null);
  const navigate = useNavigate();
  const { canGoBack, canGoForward } = useTrail();
  // The listener is attached once and reads the trail of the moment.
  const trail = useRef({ canGoBack, canGoForward });
  trail.current = { canGoBack, canGoForward };

  useEffect(() => {
    const onMenu = (event: MouseEvent) => {
      // A control with a menu of its own (the app's name) took it already.
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (import.meta.env.DEV && event.shiftKey) return;
      event.preventDefault();
      const menu: MenuGroups = [];

      const link = target?.closest<HTMLAnchorElement>("a[href]");
      if (link) {
        const url = new URL(link.href, location.href);
        const group: MenuEntry[] = [{ label: "Open link", icon: ExternalLink, run: () => link.click() }];
        // A page of the app opens in a tab or a window of its own, as the
        // modified clicks do (main.tsx). An outside address has only the
        // browser.
        if (inTauri && url.origin === location.origin) {
          const path = `${url.pathname}${url.hash}`;
          group.push(
            { label: "Open in new tab", icon: Plus, keys: `${COMMAND_KEY}+Click`, run: () => openTab(path, { background: true }) },
            { label: "Open in new window", icon: AppWindow, keys: "Shift+Click", run: () => invoke("new_window", { path }) },
          );
        }
        group.push({ label: "Copy link address", icon: Link2, run: () => shareable(link.href).then((text) => copyText(text, "Link copied")) });
        menu.push(group);
      }
      // The lightbox is the picture alone: anywhere on it, the menu is the
      // picture's, with nothing of the page under it.
      const lightbox = target?.closest<HTMLElement>("[data-lightbox]");

      // A help icon, in the page's title or large in the lightbox: what a
      // pipeline developer comes for is its name in Houdini and the file.
      const icon = lightbox
        ? lightbox.querySelector<HTMLElement>("[data-icon]")
        : target?.closest<HTMLElement>("[data-icon]");
      if (icon?.dataset.icon) {
        const source = icon.dataset.icon;
        const name = houdiniIconName(source);
        const group: MenuEntry[] = [];
        if (icon.tagName === "BUTTON") group.push({ label: "Open icon", icon: Image, run: () => icon.click() });
        group.push({ label: `Copy icon name (${name})`, icon: Tag, run: () => copyText(name, "Icon name copied") });
        menu.push(group, iconFileEntries(source, !!lightbox));
      }
      // A picture, not an icon, large in the lightbox.
      const large = lightbox && !icon ? lightbox.querySelector<HTMLImageElement>("img:not([data-icon])") : null;
      if (large) menu.push([{ label: "Copy image", icon: Copy, keys: `${COMMAND_KEY}+C`, run: () => copyPicture(large) }]);
      if (lightbox) {
        if (menu.length) setAt({ x: event.clientX, y: event.clientY, menu });
        return;
      }

      const picture = target?.closest<HTMLImageElement>(PAGE_PICTURES);
      if (picture) {
        menu.push([
          { label: "Open picture", icon: Image, run: () => openLightbox(picture) },
          { label: "Copy image", icon: Copy, run: () => copyPicture(picture) },
        ]);
      }

      const page = pageActions();
      if (page && target?.closest("[data-current-crumb]")) {
        menu.push([{ label: "Reveal in sidebar", icon: ListTree, run: revealInSidebar }]);
      }

      // One Copy, as Ctrl C does: the selection when there is one, else the
      // whole page as Markdown.
      const selected = window.getSelection()?.toString().trim() ? window.getSelection()!.toString() : "";
      const copy: MenuEntry = {
        label: "Copy",
        icon: Copy,
        keys: `${COMMAND_KEY}+C`,
        run: () =>
          selected || !page
            ? copyText(selected, "Copied")
            : page.copy().then((done) => done && showToast("Markdown copied to clipboard")),
      };
      if (!page && selected) menu.push([copy]);

      // The page's own actions, the same items as the header's drop-down.
      if (page) {
        menu.push([copy, page.copyLink, page.openOnSideFx]);
        const keep = [page.save, page.obsidian].filter((entry) => entry !== undefined);
        if (keep.length) menu.push(keep);
      }

      menu.push([
        { label: "Back", icon: ArrowLeft, keys: BACK_KEYS, disabled: !trail.current.canGoBack, run: () => navigate(-1) },
        { label: "Forward", icon: ArrowRight, keys: FORWARD_KEYS, disabled: !trail.current.canGoForward, run: () => navigate(1) },
      ]);
      setAt({ x: event.clientX, y: event.clientY, menu });
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, [navigate]);

  if (!at) return null;
  return <Panel at={at} onClose={() => setAt(null)} />;
}

function Panel({ at, onClose }: { at: { x: number; y: number; menu: MenuGroups }; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: at.x, top: at.y });

  // Open down and right of the pointer, or up and left where the window ends.
  useLayoutEffect(() => {
    const box = panel.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const left = at.x + width > innerWidth - 4 ? Math.max(4, at.x - width) : at.x;
    const top = at.y + height > innerHeight - 4 ? Math.max(4, at.y - height) : at.y;
    setPlace({ left, top });
    // The menu takes the keys; an item lights only once the arrows reach it.
    box.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <MenuList
      ref={panel}
      label="Actions"
      groups={at.menu}
      style={place}
      className="fixed z-[80] min-w-56"
      onClose={onClose}
      onRun={() => used("right-click")}
    />
  );
}
