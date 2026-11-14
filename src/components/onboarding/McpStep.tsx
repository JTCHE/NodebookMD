import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { invoke } from "@/lib/backend";
import { TEXT_LINK } from "@/lib/ui/button";
import { SettingRow } from "./SettingRow";
import { CHOICE_HANG, ChoiceRow } from "./ChoiceRow";

const MCP_REPO = "https://github.com/JTCHE/houdini-mcp";

interface Agent {
  key: string;
  label: string;
}

/**
 * The switch that installs Houdini MCP, and the agent it connects to.
 *
 * The list is what `mcp_agents` found, in the installer's own order, and the
 * first one is the default. A machine with no agent gets no switch: there is
 * nothing to connect, so the step says where to start instead.
 */
export function McpStep({
  on,
  onToggle,
  agent,
  onAgent,
  onScanned,
}: {
  on: boolean;
  onToggle: (next: boolean) => void;
  /** The chosen agent's installer key, or "" until the scan is done. */
  agent: string;
  onAgent: (key: string) => void;
  /** Every agent the scan found, so the setup event can tell a machine with
      no agent from a reader who said no. */
  onScanned: (keys: string[]) => void;
}) {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    let live = true;
    void invoke<Agent[]>("mcp_agents")
      .catch(() => [])
      .then((found) => {
        if (!live) return;
        setAgents(found);
        onScanned(found.map((one) => one.key));
        if (found[0]) onAgent(found[0].key);
        else onToggle(false);
      });
    return () => {
      live = false;
    };
    // Mount only, as in `InstallStep`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (agents?.length === 0) {
    return (
      <p className="text-meta text-neutral-500">
        No supported agent found on this machine. Houdini MCP works with Claude, Codex, Gemini CLI, Cursor, opencode and
        pi. Install one, then follow the setup at{" "}
        <button
          type="button"
          onClick={() => void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(MCP_REPO))}
          onMouseDown={(event) => event.preventDefault()}
          className={TEXT_LINK}
        >
          github.com/JTCHE/houdini-mcp
        </button>
        .
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-md">
      <SettingRow label="Install Houdini MCP" checked={on} onChange={onToggle} />
      {/* Chips that wrap: the picture above shares the fixed column, and a
          list of full rows would squeeze it to a strip. */}
      {on && (
        <div className={cn(CHOICE_HANG, "flex flex-wrap gap-sm")}>
          {/* While the scan runs, empty chips hold the line the list takes, so
              the picture above does not jump when it lands. */}
          {agents === null &&
            [96, 128, 88].map((width) => (
              <span
                key={width}
                aria-hidden
                style={{ width }}
                className="h-chip rounded-lg border border-hairline bg-neutral-50"
              />
            ))}
          {agents?.map((found) => (
            <ChoiceRow
              key={found.key}
              compact
              label={found.label}
              chosen={found.key === agent}
              onClick={() => onAgent(found.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
