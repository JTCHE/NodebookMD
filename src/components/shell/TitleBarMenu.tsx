/**
 * The menu behind a right-click on the app's name in the title bar.
 *
 * The address Houdini's help pane reaches the app on, for a preference field
 * or another machine's browser: a fact about the app, seldom needed, so it
 * is here and not on screen.
 *
 * Two ways to start again: throw away what was derived from the Houdini
 * install, or throw away the reader's own data — which includes the fact that
 * they have run the setup, so the window comes back on the first launch.
 * In every build, not only in a development one. See spec: Right click on
 * the app name in the title bar.
 */
import { useEffect, useRef } from "react";
import { DatabaseZap, FileText, Server, Settings, Trash2 } from "lucide-react";
import { invoke } from "@/lib/backend";
import { showToast } from "@/components/ui/toast-notification";
import { SETTINGS_KEYS, openSettings } from "@/components/settings/SettingsDialog";
import { MenuList } from "@/components/ui/MenuList";
import { APP_NAME } from "@/lib/brand";

/** `port` is 0 when the server never started: then there is no address. */
export function TitleBarMenu({ at, port, onClose }: { at: { x: number; y: number }; port: number; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const address = `localhost:${port}`;
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [onClose]);

  /** Answered on the click, not after the backend: the pass reports its own
      progress, and every count falls to nothing and climbs back with it. */
  function resetIndex() {
    showToast("Index cleared. Reading the install again…");
    invoke("reset_index").catch((reason) => showToast(String(reason), "error"));
  }

  /** Bookmarks, recents and settings are the reader's own work and nothing
      puts them back, so this asks first. What the webview kept goes with
      them, and the window reloads into the setup. */
  async function resetUserData() {
    const { confirm } = await import("@tauri-apps/plugin-dialog");
    const sure = await confirm(
      "Bookmarks, recent pages, and every setting are removed. This cannot be undone.",
      { title: "Reset user data", kind: "warning", okLabel: "Reset" },
    );
    if (!sure) return;
    await invoke("reset_user_data");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("houdinimd.")) localStorage.removeItem(key);
    }
    window.location.reload();
  }

  return (
    <MenuList
      ref={panel}
      label={APP_NAME}
      onClose={onClose}
      style={{ top: at.y, left: at.x }}
      className="fixed z-50 min-w-52"
      groups={[
        [{ label: "Settings", icon: Settings, keys: SETTINGS_KEYS, run: openSettings }],
        [
          ...(port
            ? [
                {
                  label: "Copy server address",
                  icon: Server,
                  keys: address,
                  run: () =>
                    navigator.clipboard
                      .writeText(`http://${address}`)
                      .then(() => showToast("Copied the server address"))
                      .catch(() => showToast("Could not copy the server address", "error")),
                },
              ]
            : []),
          { label: "Open logs", icon: FileText, run: () => invoke("show_logs") },
        ],
        [
          { label: "Reset index", icon: DatabaseZap, run: resetIndex },
          { label: "Reset user data", icon: Trash2, run: resetUserData },
        ],
      ]}
    />
  );
}
