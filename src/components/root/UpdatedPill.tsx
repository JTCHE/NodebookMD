import { useEffect, useState } from "react";
import { invoke, inTauri } from "@/lib/backend";
import { openWeb } from "@/lib/web";
import { Icons } from "@/lib/ui/icons";
import { ONBOARDED } from "@/components/onboarding/Onboarding";
import { version } from "../../../src-tauri/tauri.conf.json";

/** The last version the reader was told about. */
const SEEN = "seen_version";
const NOTES = `https://github.com/JTCHE/NodebookMD/releases/tag/v${version}`;

/** Whether this launch is the first of a new version. Read as the app starts,
    before the setup can run: a reader who sets the app up in this launch is
    new, not updated, and is told nothing. A reader from before this pill
    existed has no `SEEN` but is set up, and is told. */
const updated: Promise<boolean> = inTauri
  ? Promise.all([
      invoke<string | null>("get_setting", { key: SEEN }).catch(() => version),
      invoke<string | null>("get_setting", { key: ONBOARDED }).catch(() => null),
    ]).then(([seen, onboarded]) => {
      if (seen === version) return false;
      void invoke("set_setting", { key: SEEN, value: version }).catch(() => {});
      return seen !== null || onboarded !== null;
    })
  : Promise.resolve(false);
/** Closed in this launch: the home page shown again does not bring it back. */
let closed = false;

/** A pill at the top of the home page after an update: the version it is
    now, and a way to read what changed. Until it is closed, or for this
    launch only: the next launch is not an update. */
export function UpdatedPill() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    void updated.then((yes) => live && setShown(yes && !closed));
    return () => {
      live = false;
    };
  }, []);
  if (!shown) return null;
  const close = () => {
    closed = true;
    setShown(false);
  };
  return (
    <div
      role="status"
      className="pop-in absolute top-lg left-1/2 z-10 flex -translate-x-1/2 items-center gap-xs rounded-full border border-border bg-background py-2xs pr-2xs pl-md text-meta text-neutral-700 shadow-lg"
    >
      <span>Updated to v{version}</span>
      <button
        type="button"
        onClick={() => {
          void openWeb(NOTES);
          close();
        }}
        className="cursor-interactive rounded-full px-sm py-[3px] font-medium text-brand transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        What's new
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className="grid size-[24px] cursor-interactive place-items-center rounded-full text-neutral-500 transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-200 pointer-hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Icons.dismiss className="size-[12px]" />
      </button>
    </div>
  );
}
