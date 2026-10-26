import "./lib/old-keys";
import { StrictMode, type ReactNode } from "react";
import { invoke, inTauri } from "./lib/backend";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Router, Routes } from "react-router";
import Home from "./routes/Home";
import Page from "./routes/Page";
import { AppShell } from "./components/shell/AppShell";
import { ToastListener } from "./components/ui/toast-notification";
import { DeepLinks } from "./components/shell/DeepLinks";
import { startTheme } from "./lib/ui/theme";
import { startPress } from "./lib/ui/press";
import { startBlurCheck } from "./lib/ui/blur";
import { startIconStroke } from "./lib/ui/icon-stroke";
import { startZoomKeys } from "./lib/ui/zoom";
import { IS_MAC, letterOf } from "./lib/hotkeys";
import { current, navigator as tabNavigator, openTab, useTabs } from "./lib/tabs";
import "./styles/globals.css";

// `bun run app --clean` starts the app as a machine that has never run it.
// The index lives in a fresh directory on the Rust side; what the reader kept
// lives here, in the webview, so it is dropped here.
if (await invoke<boolean>("clean_start").catch(() => false)) {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("nodebookmd.")) localStorage.removeItem(key);
  }
}

// Light or dark before the first paint, so the window never flashes the
// other theme on the way in.
startTheme();
startBlurCheck();
startIconStroke();

if (import.meta.env.PROD) {
  // Ctrl J opens the webview's downloads list, which this window has no use for.
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "j") event.preventDefault();
  });
}

// `bun run app` has the browser tools. F12 and Ctrl Shift I open them here
// too, so they do not depend on the keys the webview keeps for itself.
if (import.meta.env.DEV && inTauri) {
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "f12" || (event.ctrlKey && event.shiftKey && key === "i")) void invoke("open_devtools").catch(() => {});
  });
}

// An error nothing caught goes to the telemetry, which sends nothing unless
// the reader agreed to it. See src-tauri/src/telemetry.rs.
if (inTauri) {
  const report = (message: string) => void invoke("report_error", { message }).catch(() => {});
  window.addEventListener("error", (event) => report(`${event.message}\n${event.error?.stack ?? ""}`));
  window.addEventListener("unhandledrejection", (event) => report(String(event.reason?.stack ?? event.reason)));
}

if (inTauri && !/Windows/.test(navigator.userAgent)) {
  startZoomKeys();
  // ⌘R (Ctrl R on Linux) and F5 reload, as WebView2 does by itself on Windows.
  // The tabs come back from the store, as at a start.
  document.addEventListener("keydown", (event) => {
    const command = IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey;
    if (event.key !== "F5" && !(command && !event.altKey && !event.shiftKey && letterOf(event) === "r")) return;
    event.preventDefault();
    location.reload();
  });
}

// Every control in the window acts on the press from here on — one listener,
// no prop to remember. See lib/ui/press.
startPress();

// Houdini's help pane opens no window for a link that asks for one: an outside
// link did nothing there. The local server opens it in the reader's browser.
// Only in that pane, not in a browser on another machine, where the link must
// open on that machine. Added after the press rule, which cancels the leftover
// click of a press, so that click is not sent a second time.
if (!inTauri && /QtWebEngine/.test(navigator.userAgent)) {
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || event.defaultPrevented) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin || !/^https?:$/.test(url.protocol)) return;
      event.preventDefault();
      void invoke("open_url", { url: url.href }).catch(() => {});
    },
    true,
  );
}

// A link to a page with a key held, as in a browser: Ctrl or ⌘, or the middle
// button, opens it in a tab behind this one; add Shift and the tab comes to
// the front; Shift alone opens a new window. Left to itself the webview hands
// the link to the reader's browser, which has no backend to read the page from.
if (inTauri) {
  const openElsewhere = (event: MouseEvent) => {
    const command = event.ctrlKey || event.metaKey;
    const modified = event.button === 0 && (command || event.shiftKey);
    if (!(modified || event.button === 1) || event.defaultPrevented) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    const path = `${url.pathname}${url.hash}`;
    if (event.button === 0 && event.shiftKey && !command) void invoke("new_window", { path }).catch(() => {});
    else openTab(path, { background: !event.shiftKey });
  };
  document.addEventListener("click", openElsewhere, true);
  document.addEventListener("auxclick", openElsewhere, true);
}

/** The desktop window's router: the location is the active tab's, and every
    move goes into that tab's trail. See lib/tabs. */
function TabRouter({ children }: { children: ReactNode }) {
  const { tabs, active } = useTabs();
  const tab = tabs[active];
  return (
    <Router location={current(tab)} navigationType={tab.action} navigator={tabNavigator}>
      {children}
    </Router>
  );
}

const AppRouter = inTauri ? TabRouter : BrowserRouter;

// Real paths, because Houdini asks for `/nodes/sop/box` flat and the reader
// should see that in the address bar of the help window. The localhost server
// answers any page path with the app; the desktop window never asks for one,
// because it only ever pushes state.
//
// The shell is OUTSIDE the routes, so the title bar and the panel are mounted
// once for the life of the window and only the content column changes.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/*" element={<Page />} />
        </Routes>
      </AppShell>
      <ToastListener />
      <DeepLinks />
    </AppRouter>
  </StrictMode>,
);
