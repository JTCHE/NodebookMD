/**
 * F1 in each Houdini release: whether it opens this app. Settings, the
 * version picker and its nudge read one list, so a switch in one shows in the
 * others at once.
 */
import { useEffect, useSyncExternalStore } from "react";
import { invoke } from "@/lib/backend";
import { APP_NAME } from "@/lib/brand";

/** One Houdini release series, as `houdini_releases` sees its preferences. A
    series with no preferences folder is absent: that Houdini never ran. */
export interface Release {
  release: string;
  url: string | null;
  /** Whether the release uses an external help server at all. */
  external: boolean;
  ours: boolean;
}

let releases: Release[] | null = null;
const listeners = new Set<() => void>();

/** Reads the list again from the preferences on disk. */
export async function readReleases() {
  releases = await invoke<Release[]>("houdini_releases").catch(() => []);
  for (const notify of listeners) notify();
}

/** `null` until the first read is in. Read again each time the window
    gets the focus: the reader can start a Houdini for the first time, or
    change its preferences, while the app runs. */
export function useReleases(): Release[] | null {
  useEffect(() => {
    if (releases === null) void readReleases();
    const onFocus = () => void readReleases();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => releases,
  );
}

/** Whether F1 in `release` opens this app. `undefined` when that release has
    no preferences folder yet, or the list is not read. */
export function hooked(list: Release[] | null, release: string): boolean | undefined {
  const one = list?.find((r) => r.release === release);
  return one && one.external && one.ours;
}

/** Gives F1 in `release` to this app, or back to Houdini. Resolves with what
    to tell the reader; throws with the reason it could not. */
export async function setHelpServer(release: string, on: boolean): Promise<string> {
  let changed: string[];
  try {
    changed = await invoke<string[]>(on ? "hook_houdini" : "unhook_houdini", { releases: [release] });
  } finally {
    await readReleases();
  }
  if (on) return `F1 in Houdini ${release} now opens ${APP_NAME}. Restart Houdini.`;
  if (!changed.length) throw `${APP_NAME} is not the help server of Houdini ${release}. Nothing changed.`;
  return `${APP_NAME} is no longer the help server of Houdini ${release}. Restart Houdini, then F1 opens Houdini's own help.`;
}

/** `22.0.368` is `22.0`: the hook is per preferences folder, which is per
    series. Rust's `hook::series_of` does the same. */
export function seriesOf(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}
