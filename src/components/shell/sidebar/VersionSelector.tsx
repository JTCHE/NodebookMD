/**
 * Which Houdini the app is reading.
 *
 * The whole promise of the app is that the docs match the install, so the
 * build is the first thing in the panel and it is named in full.
 *
 * In the desktop window this is a picker: every install on the machine, one
 * row each, naming its build and how much of it is indexed. In Houdini's help
 * pane it stays a label — which Houdini pressed F1 decides the build there,
 * so a switcher would be a lie. `inTauri` is what tells the two apart. See
 * spec: Local — Multiple Houdini Versions, Local — What the help pane shows.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { invoke, inTauri } from "@/lib/backend";
import { hooked as hookedIn, readReleases, seriesOf, setHelpServer, useReleases } from "@/lib/help-server";
import { announceBuildChanged, indexedShare, pagesLabel, pickInstall, useIndex, type IndexStatus } from "@/lib/install";
import { showToast } from "@/components/ui/toast-notification";
import { TooltipBox } from "@/components/docs/Tooltip";
import { APP_NAME } from "@/lib/brand";

interface VersionSelectorProps {
  /** `null` while the install is still being read. */
  version: string | null;
  pageCount: number | null;
  className?: string;
}

/** One row of the picker: a build and how much of it is indexed. */
interface BuildRow {
  version: string;
  pages: number;
  done: boolean;
  current: boolean;
}

/** Every row of the popover, so the folder row cannot drift from the builds. */
const ROW =
  "flex w-full cursor-interactive items-center justify-between gap-sm rounded-md px-sm py-[7px] text-left text-[13px] " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none disabled:cursor-default " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Stands for the folder row in `switching`, which otherwise holds a build. */
const PICK = "\0pick";

/** A key cap, small enough to sit at the end of a row. */
const CHIP =
  "mr-sm inline-flex h-4 shrink-0 items-center rounded-[4px] border px-1 text-[10px] font-semibold leading-none " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Keys that work the picker itself. Any other key closes it: the reader
    has moved on to something else. */
const PICKER_KEYS = new Set(["Tab", "Shift", "Enter", " ", "ArrowUp", "ArrowDown"]);

/** What the right of a row says about a build. Only the current build can be
    mid-pass: a switch stops the pass of the build it leaves. */
function indexState(row: BuildRow, switching: boolean, status: IndexStatus | null): string {
  if (switching) return "Switching…";
  if (row.done) return `${row.pages.toLocaleString()} pages`;
  if (row.current) return indexedShare(status) ?? "Indexing…";
  return "Click to index";
}

export function VersionSelector({ version, pageCount, className }: VersionSelectorProps) {
  if (!inTauri) {
    return (
      <Card
        version={version}
        pageCount={pageCount}
        className={className}
      />
    );
  }
  return (
    <Picker
      version={version}
      pageCount={pageCount}
      className={className}
    />
  );
}

/** The card alone, as a label. What the help pane shows, and what the picker
    below draws itself as before it is opened. */
function Card({
  version,
  pageCount,
  className,
  onClick,
  expanded,
}: VersionSelectorProps & { onClick?: () => void; expanded?: boolean }) {
  const { status } = useIndex();
  return (
    <button
      type="button"
      disabled={!onClick}
      aria-haspopup={onClick ? "listbox" : undefined}
      aria-expanded={onClick ? expanded : undefined}
      title={onClick ? "Read the docs for a different Houdini" : "Which Houdini pressed F1 decides this"}
      onClick={onClick}
      className={cn(
        "flex h-[46px] w-full items-center justify-between rounded-lg px-ms text-left",
        "border border-hairline bg-raised shadow-chip",
        onClick && "cursor-interactive pointer-hover:bg-neutral-100",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium tracking-[-0.012em] text-neutral-950">
          {/* `null` is not read yet, which is not the same as no install. */}
          {version ? `Houdini ${version}` : version === null ? "Houdini" : "No Houdini install found"}
        </span>
        <span className="truncate text-caption text-neutral-500">
          {pageCount === null ? "Reading the install…" : pagesLabel(pageCount, status)}
        </span>
      </span>
      <Icons.versionPicker className="size-ms shrink-0 text-neutral-500" />
    </button>
  );
}

/**
 * The F1 key of one release series. Lit when F1 in that Houdini opens this
 * app; a click gives F1 back, or takes it. Two builds of one series share one
 * preferences folder, so their chips always agree.
 */
function F1Chip({
  release,
  hooked,
  onToggle,
}: {
  release: string;
  /** `undefined` when the series has no preferences folder yet. */
  hooked: boolean | undefined;
  onToggle: () => Promise<void>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = hooked !== undefined;

  const title = `Houdini ${release} integration`;
  const text = !known
    ? `Start Houdini ${release} one time. Then ${APP_NAME} can open from its F1.`
    : hooked
      ? `${APP_NAME} is set as the default help server for this version. Click to remove.`
      : `Click to set ${APP_NAME} as the default help server for this version.`;

  return (
    <>
      <button
        ref={ref}
        type="button"
        // Not `disabled`: a disabled button gets no hover, and the hint is
        // what says why it does nothing.
        aria-disabled={!known || busy}
        aria-pressed={known ? hooked : undefined}
        aria-label={`${title}. ${text}`}
        onClick={async () => {
          if (!known || busy) return;
          setBusy(true);
          try {
            await onToggle();
          } finally {
            setBusy(false);
          }
        }}
        onMouseEnter={() => setHint(true)}
        onMouseLeave={() => setHint(false)}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setHint(true)}
        onBlur={() => setHint(false)}
        className={cn(
          CHIP,
          !known
            ? "cursor-default border-hairline text-neutral-300"
            : hooked
              ? "cursor-interactive border-brand/40 bg-brand/10 text-brand"
              : "cursor-interactive border-hairline text-neutral-400 pointer-hover:text-neutral-700",
          busy && "opacity-50",
        )}
      >
        F1
      </button>
      {hint && (
        <TooltipBox
          anchorRef={ref}
          className="w-max max-w-[15rem]"
        >
          <span className="block font-semibold text-foreground">{title}</span>
          <span className="mt-0.5 block text-muted-foreground">{text}</span>
        </TooltipBox>
      )}
    </>
  );
}

/** The card, plus the popover it opens: every install on the machine. */
function Picker({ version, pageCount, className }: VersionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BuildRow[] | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const releases = useReleases();
  const wrapper = useRef<HTMLDivElement>(null);
  const { status } = useIndex();
  const { pathname } = useLocation();

  // A rescan is the picker's own cost to pay, not every page's — see
  // spec: Local — Multiple Houdini Versions.
  useEffect(() => {
    if (!open) return;
    setRows(null);
    void invoke<BuildRow[]>("available_installs")
      .catch(() => [])
      .then(setRows);
    void readReleases();
  }, [open]);

  async function toggleF1(release: string, hooked: boolean) {
    await setHelpServer(release, !hooked).then(showToast, (reason) => showToast(String(reason), "error"));
  }

  // Open, the picker is the one thing the reader is doing. Anything else —
  // a press elsewhere, a shortcut, a wheel, another page, another window —
  // puts it away.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    function outside(e: Event) {
      if (!wrapper.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (!PICKER_KEYS.has(e.key) || !wrapper.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("wheel", outside, true);
    document.addEventListener("focusin", outside);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("wheel", outside, true);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  // A move to another page, by a key or a link, is an interaction too.
  const [shownPath, setShownPath] = useState(pathname);
  if (pathname !== shownPath) {
    setShownPath(pathname);
    setOpen(false);
  }

  // The F1 key of this build's Houdini, on the card itself, so the reader
  // sees and sets it without opening the picker. It stays, lit or not, as
  // the key in the picker's row does. Only for a release that has run once,
  // so there is an F1 to take.
  const currentSeries = version ? seriesOf(version) : "";
  const currentHooked = currentSeries ? hookedIn(releases, currentSeries) : undefined;

  async function pick(row: BuildRow) {
    if (row.current) {
      setOpen(false);
      return;
    }
    setSwitching(row.version);
    try {
      await invoke("select_install", { version: row.version });
      announceBuildChanged();
    } finally {
      setSwitching(null);
      setOpen(false);
    }
  }

  async function browse() {
    setSwitching(PICK);
    try {
      if (await pickInstall()) setOpen(false);
    } catch (reason) {
      showToast(String(reason), "error");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div
      ref={wrapper}
      className={cn("relative", className)}
    >
      <Card
        version={version}
        pageCount={pageCount}
        onClick={() => setOpen((v) => !v)}
        expanded={open}
      />
      {currentHooked !== undefined && (
        // Beside the chevron, over the card and not inside it: a button
        // cannot hold a button.
        <div className="absolute top-1/2 right-lg flex -translate-y-1/2">
          <F1Chip release={currentSeries} hooked={currentHooked} onToggle={() => toggleF1(currentSeries, currentHooked)} />
        </div>
      )}
      <div
        role="listbox"
        aria-label="Houdini installs on this machine"
        className={cn(
          "absolute left-0 top-full z-10 mt-1 w-full origin-top overflow-hidden rounded-lg",
          "border border-hairline bg-raised p-1 shadow-xl shadow-black/10",
          "transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
          open ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.98]",
        )}
      >
        {rows === null ? (
          <p className="px-sm py-sm text-caption text-neutral-500">Looking for Houdini…</p>
        ) : (
          <>
            {rows.length === 0 && <p className="px-sm py-sm text-caption text-neutral-500">No Houdini install found.</p>}
            {rows.map((row) => {
              const release = seriesOf(row.version);
              const hooked = hookedIn(releases, release);
              return (
                <div
                  key={row.version}
                  className={cn("flex items-center rounded-md", !row.current && "pointer-hover:bg-neutral-100")}
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={row.current}
                    disabled={switching !== null}
                    onClick={() => void pick(row)}
                    className={cn(ROW, "min-w-0 flex-1", row.current ? "text-brand" : "text-neutral-800")}
                  >
                    <span className="truncate font-medium tracking-[-0.012em]">Houdini {row.version}</span>
                    <span className="shrink-0 text-caption text-neutral-500">
                      {indexState(row, switching === row.version, status)}
                    </span>
                  </button>
                  {releases === null ? (
                    <span
                      aria-hidden="true"
                      className={cn(CHIP, "invisible")}
                    >
                      F1
                    </span>
                  ) : (
                    <F1Chip
                      release={release}
                      hooked={hooked}
                      onToggle={() => toggleF1(release, hooked === true)}
                    />
                  )}
                </div>
              );
            })}
            {/* An install outside Program Files is invisible to the scan, and a
                studio puts its builds wherever it likes. Onboarding asks with
                the same call — see `pickInstall`. */}
            <button
              type="button"
              role="option"
              aria-selected={false}
              disabled={switching !== null}
              onClick={() => void browse()}
              className={cn(ROW, "text-neutral-800 pointer-hover:bg-neutral-100")}
            >
              <span className="truncate font-medium tracking-[-0.012em]">Pick a folder…</span>
              <span className="shrink-0 text-caption text-neutral-500">
                {switching === PICK ? "Reading…" : "Elsewhere on this machine"}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
