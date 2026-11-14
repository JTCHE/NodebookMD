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
import { TEXT_LINK } from "@/lib/ui/button";
import { Modal, MODAL_LINE, MODAL_TOP } from "@/components/ui/Modal";
import { SidebarRow } from "@/components/shell/sidebar/SidebarRow";
import { Toggle } from "@/components/ui/Toggle";
import { Segmented } from "@/components/ui/Segmented";
import { showToast } from "@/components/ui/toast-notification";
import { TELEMETRY } from "@/components/onboarding/Onboarding";
import { useVaults } from "@/components/obsidian/ObsidianDialog";
import { APP_NAME } from "@/lib/brand";
import { THEME_CHOICES, THEME_LABEL, setTheme, useThemeChoice } from "@/lib/ui/theme";
import { LINK_FORMATS, linkFormat, setLinkFormat, type LinkFormat } from "@/lib/link";
import { restoresTabs, setRestoresTabs } from "@/lib/tabs";
import { setHelpServer, useReleases } from "@/lib/help-server";
import { OBSIDIAN_PICTURES, OBSIDIAN_VAULT, pickFolder, picturesChoice, rememberedVault, type PicturesChoice } from "@/lib/obsidian";

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
    <Modal label="Settings" onClose={() => setOpen(false)} className="h-[min(560px,100%)] w-full max-w-[760px] flex-row">
      {/* The panel's own rows, on the panel's own ground: the sections are
          places, as the sidebar's rows are. */}
      <nav className={cn("flex w-[200px] shrink-0 flex-col border-r border-hairline bg-neutral-100 px-md pb-md", MODAL_TOP)}>
        <span className={cn(MODAL_LINE, "text-caption text-neutral-500")}>Settings</span>
        {/* The rows give their padding back, so their names stand on the
            axis of the title above them. A row stands 8px inside the
            dialog's 12px corner, so its corner is 4px and the two nest. */}
        <div className="-mx-sm flex flex-col gap-2xs">
          {SECTIONS.map((one) => (
            <SidebarRow
              key={one.key}
              label={one.label}
              bare
              className="rounded-sm"
              selected={shown === one.key}
              mark={<one.icon className={cn("size-[15px]", shown === one.key ? "text-brand" : "text-neutral-500")} />}
              onClick={() => setShown(one.key)}
            />
          ))}
        </div>
      </nav>
      <div className={cn("flex min-w-0 flex-1 flex-col", MODAL_TOP)}>
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

/** A tab of Settings. The title stays where it is on every tab; the rows
    under it scroll. The title is the tab's name, so the eye finds it in the
    same place each time. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {/* The close button stands at the end of this line. */}
      <h2 className={cn(MODAL_LINE, "mb-sm truncate px-lg pr-2xl text-[17px] font-semibold tracking-[-0.01em] text-neutral-950")}>
        {title}
      </h2>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-lg pb-lg">{children}</div>
    </section>
  );
}

/** Rows that belong together. Between two groups, one line runs the full
    width of the pane; between rows of one group, the line stops at the text. */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col border-b border-hairline last:border-b-0 -mx-lg px-lg">{children}</div>;
}

/** One setting: what it is, a fact the reader needs to act, and its control.
    Every row on every tab is this one row, so all of them are one height.
    The line under it is outside that height, so the space above a line and
    the space below it are the same. */
function Row({ label, detail, children }: { label: string; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="box-content flex h-setting shrink-0 items-center gap-md border-b border-hairline last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-title font-medium text-neutral-950">{label}</span>
        {detail && <span className="truncate text-caption text-neutral-500">{detail}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-ms text-meta text-neutral-500">{children}</p>;
}

/** The one button style of Settings: as tall as a picker, with its radius. */
const BUTTON =
  "h-row shrink-0 cursor-interactive rounded-lg border border-hairline bg-raised px-ms text-label font-medium text-neutral-800 shadow-chip " +
  "transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-100 active:bg-neutral-200 " +
  "disabled:cursor-wait disabled:text-neutral-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** F1 in each Houdini release installed on the machine. A release series
    has its own preferences, so each one has its own switch. */
function HelpSection() {
  const releases = useReleases();

  async function flip(release: string, on: boolean) {
    await setHelpServer(release, on).then(showToast, (reason) => showToast(String(reason), "error"));
  }

  return (
    <Section title="Houdini Integration">
      {releases?.length === 0 && <Empty>No installed Houdini found on this machine.</Empty>}
      {releases?.map((one) => (
        <Row
          key={one.release}
          label={`Houdini ${one.release}`}
          // The switch says whether F1 opens this app. Only a third help
          // server is a fact the switch cannot show: turning it on replaces it.
          detail={one.external && one.url && !one.ours ? `F1 opens ${one.url}` : undefined}
        >
          <Toggle
            checked={one.external && one.ours}
            onChange={(next) => void flip(one.release, next)}
            label={`F1 in Houdini ${one.release} opens ${APP_NAME}`}
          />
        </Row>
      ))}
    </Section>
  );
}

interface Agent {
  key: string;
  label: string;
  /** What the agent's own config says. See `mcp::Link`. */
  link: "ours" | "other" | "none";
}

const LINK: Record<Agent["link"], string> = {
  ours: "Connected",
  other: "Runs another Houdini MCP",
  none: "Not connected",
};

/** Houdini MCP, read from each agent's own config: the truth, whoever
    installed it. Read again each time the window gets the focus, so an agent
    installed while Settings is open shows when the reader comes back. */
function McpSection() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [busy, setBusy] = useState("");

  const scan = useCallback(() => {
    void invoke<Agent[]>("mcp_agents")
      .catch(() => [])
      .then(setAgents);
  }, []);
  useEffect(() => {
    scan();
    window.addEventListener("focus", scan);
    return () => window.removeEventListener("focus", scan);
  }, [scan]);

  async function install(agent: Agent) {
    setBusy(agent.key);
    try {
      await invoke("install_houdini_mcp", { agent: agent.key });
      showToast(`Houdini MCP is connected to ${agent.label}. Restart Houdini and ${agent.label}.`);
      scan();
    } catch (reason) {
      showToast(`Houdini MCP did not install: ${String(reason)}`, "error");
    } finally {
      setBusy("");
    }
  }

  return (
    <Section title="Houdini MCP">
      {agents === null && <Empty>Looking for agents…</Empty>}
      {agents?.length === 0 && (
        <Empty>
          No supported agent found on this machine. Houdini MCP works with Claude, Codex, Gemini CLI, Cursor, opencode and
          pi.
        </Empty>
      )}
      {agents?.map((agent) => (
        <Row
          key={agent.key}
          label={agent.label}
          detail={
            <span className={cn("inline-flex items-center gap-2xs", agent.link === "ours" && "text-brand-700")}>
              {agent.link === "ours" && <Icons.chosen className="size-3" />}
              {LINK[agent.link]}
            </span>
          }
        >
          <button type="button" disabled={busy !== ""} className={BUTTON} onClick={() => void install(agent)}>
            {busy === agent.key ? "Installing…" : agent.link === "ours" ? "Update" : "Connect"}
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
          "h-row max-w-[220px] cursor-interactive appearance-none truncate rounded-lg bg-neutral-100 pr-xl pl-ms text-label font-medium text-neutral-950",
          "ring-1 ring-hairline ring-inset transition-colors duration-(--duration-fast) motion-reduce:transition-none pointer-hover:bg-neutral-200",
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
        className="pointer-events-none absolute top-1/2 right-sm size-3.5 -translate-y-1/2 text-neutral-500"
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
      <Group>
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={theme}
            options={THEME_CHOICES.map((choice) => ({ value: choice, label: THEME_LABEL[choice] }))}
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
      </Group>
      {inTauri && (
        <Group>
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
        </Group>
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
      <Row
        label="Send anonymous usage data"
        detail={
          <button
            type="button"
            className={TEXT_LINK}
            onClick={() => void invoke("show_telemetry_log").catch((reason) => showToast(String(reason), "error"))}
          >
            See what is sent
          </button>
        }
      >
        {on !== null && <Toggle checked={on} onChange={(next) => void flip(next)} label="Send anonymous usage data" />}
      </Row>
    </Section>
  );
}
