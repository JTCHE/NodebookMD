/**
 * Settings, over the page the reader is on, not in place of it.
 *
 * Every section is the same shape: a title, then rows of label, state and
 * control, so no part reads as a different app. A label says what a setting
 * is; no line under it explains it again. A setting
 * is read from the backend each time the dialog opens, never cached, so it
 * says what is true now: a Houdini installed since the setup, an agent that
 * got Houdini MCP from somewhere else.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke, inTauri } from "@/lib/backend";
import { COMMAND_KEY, IS_MAC, isCommand, useHotkey } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { Icons } from "@/lib/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { SidebarRow } from "@/components/shell/sidebar/SidebarRow";
import { Toggle } from "@/components/ui/Toggle";
import { Segmented, TRACK } from "@/components/ui/Segmented";
import { showToast } from "@/components/ui/toast-notification";
import { TELEMETRY } from "@/components/onboarding/Onboarding";
import { useVaults } from "@/components/obsidian/ObsidianDialog";
import { APP_NAME } from "@/lib/brand";
import { THEME_CHOICES, THEME_LABEL, setTheme, useThemeChoice } from "@/lib/ui/theme";
import { LINK_FORMATS, linkFormat, setLinkFormat, type LinkFormat } from "@/lib/link";
import { restoresTabs, setRestoresTabs } from "@/lib/tabs";
import { seriesOf, setHelpServer, useReleases, type Release } from "@/lib/help-server";
import type { Install } from "@/lib/install";
import {
  OBSIDIAN_PICTURES,
  OBSIDIAN_VAULT,
  pickFolder,
  picturesChoice,
  rememberedVault,
  type PicturesChoice,
} from "@/lib/obsidian";

const OPEN = "nodebookmd:settings";

/** The keys that open Settings, as the menu and the tooltip show them. */
export const SETTINGS_KEYS = `${COMMAND_KEY}+,`;

export function openSettings() {
  window.dispatchEvent(new Event(OPEN));
}

const SECTIONS = [
  { key: "general", label: "General", icon: Icons.settings },
  { key: "houdini", label: "Houdini Integration", icon: Icons.groupNodes },
  { key: "mcp", label: "Houdini MCP", icon: Icons.newWindow },
  { key: "obsidian", label: "Obsidian", icon: Icons.bookmark },
  { key: "usage", label: "Usage data", icon: Icons.recent },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

/** Mounted once, in the shell. */
export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<SectionKey>("general");
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);
  // Ctrl or ⌘ with a comma, as in most desktop apps.
  useHotkey((event) => {
    if (event.key !== "," || !isCommand(event) || event.shiftKey || event.altKey) return;
    event.preventDefault();
    setOpen(true);
  });
  if (!open) return null;

  const section = SECTIONS.find((one) => one.key === shown)!;
  return (
    <Modal
      label="Settings"
      onClose={() => setOpen(false)}
      // The close button stands on the title's line (see `Section`), and
      // gives back the 10px between its edge and its cross, so the cross ends
      // on the content's right edge. It stands where the title's line stands,
      // so the cross is centred on the title's capitals.
      closeAt="top-[calc(var(--spacing-lg)-6px)] right-[calc(var(--spacing-lg)-10px)]"
      // One height on every tab, so the dialog never jumps, and room for the
      // six agents Houdini MCP supports, the longest list with a known end
      // (see `Section`). Houdini Integration has no such end, so a longer
      // list scrolls. It stands tall enough to cover the page's heading.
      className="h-[min(520px,100%)] w-full max-w-[760px] flex-row"
    >
      {/* The sections are places, as the sidebar's rows are, on the panel's
          own ground. The inset is one value on every side: with the row's own
          8px it puts the mark on the content's axis, and the first row,
          30px tall, centres on the title's capitals. */}
      <nav className="flex w-[200px] shrink-0 flex-col gap-2xs border-r border-hairline bg-neutral-100 p-[calc(var(--spacing-lg)-var(--spacing-sm))]">
        {SECTIONS.map((one) => (
          <SidebarRow
            key={one.key}
            label={one.label}
            bare
            selected={shown === one.key}
            mark={
              <one.icon className={cn("size-[15px]", shown === one.key ? "text-neutral-900" : "text-neutral-500")} />
            }
            onClick={() => setShown(one.key)}
          />
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        {shown === "general" ? (
          <GeneralSection />
        ) : !inTauri ? (
          <Section title={section.label}>
            <Empty>Settings live in the {APP_NAME} app, not in Houdini's help pane.</Empty>
          </Section>
        ) : shown === "houdini" ? (
          <HelpSection />
        ) : shown === "mcp" ? (
          <McpSection />
        ) : shown === "obsidian" ? (
          <ObsidianSection />
        ) : (
          <UsageSection />
        )}
      </div>
    </Modal>
  );
}

/** A tab of Settings: its title, an action of the tab's own at the end of
    the title's line, then the rows, which scroll under the title. The
    content's inset is one value on every side. The title's capitals start
    6px below the top of its 28px line, so the line starts 6px higher and the
    capitals stand as far from the top as the text from the left. The line
    stops short of the close button: its 18px past the content edge, then one
    gap between the close button and the action's own hover box. */
function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="mt-[calc(var(--spacing-lg)-6px)] mr-[calc(var(--spacing-lg)+18px+var(--spacing-md)+var(--spacing-sm))] mb-xs ml-lg flex h-7 shrink-0 items-baseline justify-between gap-md">
        <h2 className="truncate text-[20px] leading-7 font-semibold tracking-[-0.02em] text-neutral-950">{title}</h2>
        {action}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-lg pb-lg">{children}</div>
    </section>
  );
}

/** One setting: what it is, a fact under it when the reader needs one, and
    its control on the right. Every row on every tab is one height, with or
    without the fact. Rows of a tab are siblings: a line between two of them
    runs only as wide as the content, never to the dialog's edges. A fact
    lifts the label by half its own line, so a first row with one starts
    that much lower: the label stands as far under the title on every tab. */
function Row({ label, fact, children }: { label: string; fact?: ReactNode; children?: ReactNode }) {
  return (
    <div
      className={cn(
        "box-content flex h-setting shrink-0 items-center gap-md border-b border-hairline last:border-b-0",
        fact && "first:mt-[calc((var(--text-meta)*var(--text-meta--line-height)+1px)/2)]",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-title text-neutral-950">{label}</span>
        {fact && <span className="truncate text-meta text-neutral-500">{fact}</span>}
      </span>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-ms text-label text-neutral-500">{children}</p>;
}

/** The one button that acts: raised off the ground, as a choice's track is
    sunk into it. Geist sits high in its line: 1px at the top centres it. */
const BUTTON =
  "h-row min-w-[80px] shrink-0 cursor-interactive rounded-lg border border-hairline bg-raised px-ms pt-px text-center text-label font-medium text-neutral-900 shadow-chip " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-50 active:bg-neutral-100 " +
  "disabled:cursor-wait disabled:text-neutral-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** A quiet action on a title's line. It gives its padding back, so its text
    ends on the content's right edge, where the row controls end. */
const GHOST_BUTTON =
  "-mr-sm h-7 shrink-0 cursor-interactive rounded-md px-sm text-label font-medium text-neutral-700 " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-100 pointer-hover:text-neutral-950 active:bg-neutral-200 " +
  "disabled:cursor-wait disabled:bg-transparent disabled:text-neutral-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** A fact the switch cannot show: a release that never ran has no
    preferences to write, so its switch stays off and greyed; F1 that opens
    another server is off too, but not Houdini's own help. */
function helpTarget(release: Release | undefined): string | undefined {
  if (!release) return "Open this Houdini once to set it up";
  if (release.external && !release.ours) return "F1 opens another server";
}

/** F1 in each Houdini release series installed on the machine. A series has
    its own preferences, so each has its own switch. A series that never ran
    has no preferences yet, so it has no switch until it runs once. */
function HelpSection() {
  const releases = useReleases();
  const [builds, setBuilds] = useState<string[] | null>(null);
  useEffect(() => {
    void invoke<Install[]>("installs")
      .then((list) => list.map((one) => one.version))
      .catch(() => [])
      .then(setBuilds);
  }, []);

  async function flip(release: string, on: boolean) {
    await setHelpServer(release, on).then(showToast, (reason) => showToast(String(reason), "error"));
  }

  const series =
    releases && builds
      ? [...new Set([...builds.map(seriesOf), ...releases.map((one) => one.release)])].sort((first, second) =>
          second.localeCompare(first, undefined, { numeric: true }),
        )
      : null;
  return (
    <Section title="Houdini Integration">
      {series?.length === 0 && <Empty>No installed Houdini found on this machine.</Empty>}
      {series?.map((name) => {
        const release = releases?.find((one) => one.release === name);
        return (
          <Row key={name} label={`Houdini ${name}`} fact={helpTarget(release)}>
            <Toggle
              checked={!!release?.external && !!release.ours}
              disabled={!release}
              title={release ? undefined : helpTarget(release)}
              onChange={(next) => void flip(name, next)}
              label={`F1 in Houdini ${name} opens ${APP_NAME}`}
            />
          </Row>
        );
      })}
    </Section>
  );
}

interface Agent {
  key: string;
  label: string;
  /** What the agent's own config says. See `mcp::Link`. */
  link: "ours" | "other" | "none";
}

/** Houdini MCP, read from each agent's own config: the truth, whoever
    installed it. Read again each time the window gets the focus, so an agent
    installed while Settings is open shows when the reader comes back, and
    again on Scan again. */
function McpSection() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState("");

  // The quiet read, on open and on focus; Scan again says it is working.
  const scan = useCallback(
    () =>
      invoke<Agent[]>("mcp_agents")
        .catch(() => [])
        .then(setAgents),
    [],
  );
  function scanAgain() {
    setScanning(true);
    void scan().finally(() => setScanning(false));
  }
  useEffect(() => {
    void scan();
    window.addEventListener("focus", scan);
    return () => window.removeEventListener("focus", scan);
  }, [scan]);

  async function install(agent: Agent) {
    setBusy(agent.key);
    try {
      await invoke("install_houdini_mcp", { agent: agent.key });
      showToast(`Houdini MCP is connected to ${agent.label}. Restart Houdini and ${agent.label}.`);
      void scan();
    } catch (reason) {
      showToast(`Houdini MCP did not install: ${String(reason)}`, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <Section
      title="Houdini MCP"
      action={
        <button type="button" disabled={scanning} className={GHOST_BUTTON} onClick={scanAgain}>
          {scanning ? "Scanning…" : "Scan again"}
        </button>
      }
    >
      {agents === null && <Empty>Looking for agents…</Empty>}
      {agents?.length === 0 && (
        <Empty>
          No supported agent found on this machine. Houdini MCP works with Claude, Codex, Gemini CLI, Cursor, opencode
          and pi. Install one, then scan again.
        </Empty>
      )}
      {agents?.map((agent) => (
        // Connect writes ours; Replace writes ours over another Houdini MCP;
        // Update writes ours again. The button says the state; only a
        // connected agent says so in words, with its check.
        <Row
          key={agent.key}
          label={agent.label}
          fact={
            agent.link === "ours" && (
              <span className="inline-flex items-center gap-xs text-neutral-800">
                <Icons.chosen className="size-3 text-brand" />
                Connected
              </span>
            )
          }
        >
          <button type="button" disabled={busy !== ""} className={BUTTON} onClick={() => void install(agent)}>
            {busy === agent.key ? "Installing…" : { ours: "Update", other: "Replace", none: "Connect" }[agent.link]}
          </button>
        </Row>
      ))}
    </Section>
  );
}

/** The value of the vault list's last entry: it opens a folder picker. */
const OTHER_FOLDER = "\u0000other";

/** Which vault pictures go to, as a picker of one line: the vaults Obsidian
    lists, and any other folder. */
function VaultSelect({ value, onChange }: { value: string | null; onChange: (path: string) => void }) {
  const all = useVaults(value);
  return (
    <div className="relative shrink-0">
      <select
        aria-label="Vault"
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          if (next === OTHER_FOLDER) void pickFolder().then((path) => path && onChange(path));
          else onChange(next);
        }}
        className={cn(
          // A choice, so it wears the picker's track, as wide as its longest
          // vault. The chevron stands as far in from the right as the text
          // from the left.
          TRACK,
          "max-w-[280px] cursor-interactive appearance-none truncate pt-px pr-[calc(var(--spacing-ms)+14px+var(--spacing-sm))] pl-ms text-label font-medium text-neutral-950",
          "transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-200/60",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        )}
      >
        {value === null && (
          <option value="" disabled>
            Choose a vault
          </option>
        )}
        {all.map((vault) => (
          <option key={vault.path} value={vault.path}>
            {vault.name}
          </option>
        ))}
        <option value={OTHER_FOLDER}>Other folder…</option>
      </select>
      <Icons.versionPicker
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-ms size-3.5 -translate-y-1/2 text-neutral-500"
      />
    </div>
  );
}

/** What Send to Obsidian does with a page's pictures, and which vault they go to. */
function ObsidianSection() {
  const [choice, setChoice] = useState<PicturesChoice | null>(null);
  const [vault, setVault] = useState<string | null>(null);
  useEffect(() => {
    void picturesChoice().then(setChoice);
    void rememberedVault().then(setVault);
  }, []);

  async function pick(next: PicturesChoice) {
    await invoke("set_setting", { key: OBSIDIAN_PICTURES, value: next });
    setChoice(next);
  }
  async function keep(path: string) {
    await invoke("set_setting", { key: OBSIDIAN_VAULT, value: path });
    setVault(path);
  }

  const choices: { value: PicturesChoice; label: string }[] = [
    { value: "ask", label: "Ask each time" },
    { value: "bring", label: "Bring them" },
    { value: "text", label: "Text only" },
  ];
  return (
    <Section title="Obsidian">
      <Row label="Pictures">
        <Segmented label="Pictures" value={choice} options={choices} onChange={(next) => void pick(next)} />
      </Row>
      <Row label="Vault">
        <VaultSelect value={vault} onChange={(path) => void keep(path)} />
      </Row>
    </Section>
  );
}

/** What the close button does. The Rust side reads the same key (`tray.rs`). */
const CLOSE_TO_TRAY = "close_to_tray";

/** How the app behaves as a whole: how it looks and copies, then its tabs
    and its window. The theme and the link form are kept in the browser too,
    so they work in Houdini's help pane. */
function GeneralSection() {
  const theme = useThemeChoice();
  const [format, setFormat] = useState<LinkFormat | null>(null);
  const [tray, setTray] = useState<boolean | null>(null);
  const [restore, setRestore] = useState(restoresTabs);
  useEffect(() => {
    void linkFormat().then(setFormat);
    if (inTauri)
      void invoke<string | null>("get_setting", { key: CLOSE_TO_TRAY })
        .then((value) => setTray(value !== "false"))
        .catch(() => setTray(true));
  }, []);

  async function pickFormat(next: LinkFormat) {
    await setLinkFormat(next);
    setFormat(next);
  }
  async function flipTray(next: boolean) {
    await invoke("set_setting", { key: CLOSE_TO_TRAY, value: String(next) });
    setTray(next);
  }

  const trayLabel = IS_MAC ? "Keep running in the menu bar" : "Keep running in the tray";
  return (
    <Section title="General">
      <Row label="Theme">
        <Segmented
          label="Theme"
          value={theme}
          options={THEME_CHOICES.map((choice) => ({
            value: choice,
            label: THEME_LABEL[choice],
          }))}
          onChange={setTheme}
        />
      </Row>
      <Row label="Copied links">
        {/* What each form looks like is in its tooltip, for the reader who
              asks; the row itself stays one line. */}
        <Segmented
          label="Copied links"
          value={format}
          options={(Object.keys(LINK_FORMATS) as LinkFormat[]).map((key) => ({
            value: key,
            label: LINK_FORMATS[key].label,
            hint: LINK_FORMATS[key].example,
          }))}
          onChange={(next) => void pickFormat(next)}
        />
      </Row>
      {inTauri && (
        <>
          <Row label="Open tabs again at start">
            <Toggle
              checked={restore}
              onChange={(next) => {
                setRestoresTabs(next);
                setRestore(next);
              }}
              label="Open tabs again at start"
            />
          </Row>
          <Row label={trayLabel}>
            {tray !== null && <Toggle checked={tray} onChange={(next) => void flipTray(next)} label={trayLabel} />}
          </Row>
        </>
      )}
    </Section>
  );
}

/** The telemetry switch, one click from off at any time. */
function UsageSection() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    void invoke<string | null>("get_setting", { key: TELEMETRY })
      .then((value) => setOn(value === "true"))
      .catch(() => {});
  }, []);

  async function flip(next: boolean) {
    await invoke("set_setting", { key: TELEMETRY, value: String(next) });
    setOn(next);
  }

  return (
    <Section title="Usage data">
      <Row label="Send anonymous usage data">
        {on !== null && <Toggle checked={on} onChange={(next) => void flip(next)} label="Send anonymous usage data" />}
      </Row>
      <Row label="What is sent">
        <button
          type="button"
          className={BUTTON}
          onClick={() => void invoke("show_telemetry_log").catch((reason) => showToast(String(reason), "error"))}
        >
          Show
        </button>
      </Row>
    </Section>
  );
}
