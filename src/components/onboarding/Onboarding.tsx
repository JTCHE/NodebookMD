/**
 * The first launch.
 *
 * Six screens: a welcome, the Houdini to read, F1, Houdini MCP, telemetry, and
 * what a beta is. Every screen carries a default, and Enter takes the default and moves
 * on — a reader in a hurry holds Enter and lands in the app with the settings
 * this project recommends.
 *
 * Nothing here decides anything on its own. The build is `select_install`, the
 * hook is `hook_current_build`, and the two answers are rows of
 * `user.settings` — the same calls the sidebar and the settings make.
 * See spec: Onboarding on First Launch.
 */
import { useEffect, useState } from "react";
import { invoke, inTauri } from "@/lib/backend";
import { announceBuildChanged } from "@/lib/install";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { Keycap } from "@/components/ui/Keycap";
import { StepFrame } from "./StepFrame";
import { SettingRow } from "./SettingRow";
import { InstallStep } from "./InstallStep";
import { McpStep } from "./McpStep";
import { showToast } from "@/components/ui/toast-notification";
import { setupDone } from "@/lib/telemetry";
import { APP_NAME } from "@/lib/brand";

/** The `user.settings` key that says the first launch is over. */
export const ONBOARDED = "onboarded";
/** The `user.settings` key that holds the reader's telemetry answer. */
export const TELEMETRY = "telemetry";

/** Where the step-2 picture lives: the app open in Houdini's help pane. It
    ships with the app, the way the cover picture in the README does. */
const HELP_PANE_PICTURE = "/onboarding/help-pane.webp";
/** The step-3 picture: the cover of the Houdini MCP repository. */
const MCP_PICTURE = "/onboarding/houdini-mcp.webp";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const [version, setVersion] = useState("");
  /** The build the backend has been told about, which is what starts its
      index pass. */
  const [told, setTold] = useState("");
  const [hookOn, setHookOn] = useState(true);
  const [mcpOn, setMcpOn] = useState(true);
  const [agent, setAgent] = useState("");
  /** Every agent installer key the scan found on this machine. */
  const [agentsFound, setAgentsFound] = useState<string[]>([]);
  const [telemetryOn, setTelemetryOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** A Houdini is open on the F1 step. It writes its preferences when it
      exits, which would undo the hook, so the step says to close it first. */
  const [houdiniOpen, setHoudiniOpen] = useState(false);

  // Asked again every two seconds, so the step changes as soon as the reader
  // closes Houdini.
  useEffect(() => {
    if (step !== 2 || !hookOn) return setHoudiniOpen(false);
    let live = true;
    const ask = () =>
      void invoke<boolean>("houdini_open")
        .catch(() => false)
        .then((open) => live && setHoudiniOpen(open));
    ask();
    const timer = setInterval(ask, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [step, hookOn]);
  /** The F1 step was passed with Houdini open: F1 is left as it was. */
  const skipsHook = hookOn && houdiniOpen;

  /** Whether the F1 step was skipped for an open Houdini, for the setup's
      one telemetry event. */
  const [skippedHook, setSkippedHook] = useState(false);

  async function advance() {
    if (busy) return;
    if (step === 2) setSkippedHook(skipsHook);
    setError("");
    setBusy(true);
    try {
      await commit(step);
      if (step === 5) {
        onDone();
        return;
      }
      setStep(step + 1);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  /** What leaving a step writes. Each one is the reader's answer, applied
      before the next screen can depend on it. */
  async function commit(leaving: number) {
    // The build was chosen on the screen itself, so the index has been running
    // while the reader answered the rest of the setup.
    if (leaving === 1) await choose(version);
    if (leaving === 2 && hookOn && !skipsHook) await invoke("hook_current_build");
    // The download takes longer than the rest of the setup, so the setup does
    // not wait on it. The toast says how it ended, on whatever screen is open.
    if (leaving === 3 && mcpOn && agent) {
      void invoke("install_houdini_mcp", { agent }).then(
        () => showToast("Houdini MCP is installed. Restart Houdini and your agent."),
        (reason) => showToast(`Houdini MCP did not install: ${String(reason)}`, "error"),
      );
    }
    if (leaving === 4) await invoke("set_setting", { key: TELEMETRY, value: String(telemetryOn) });
    if (leaving === 5) {
      await invoke("set_setting", { key: ONBOARDED, value: "done" });
      // The only event that says a setup ended, so it is also how many
      // installs never finish one. `mcp` separates the two ways to end up
      // without it: `none` is a machine with no agent to connect, `off` is a
      // reader who had one and said no. `agents` is what the scan found, so
      // a missing agent is countable rather than guessed at.
      const mcp = mcpOn && agent ? agent : agentsFound.length === 0 ? "none" : "off";
      setupDone(`hook=${hookOn ? (skippedHook ? "skipped" : "true") : "false"} mcp=${mcp} agents=${agentsFound.join(",") || "none"}`);
    }
  }

  /** Selecting a build is what starts its index, so it is applied the moment
      the reader picks one — not when they leave the screen. A first index
      takes seconds, and the rest of the setup takes longer than that, so by
      the landing page it is done. */
  async function choose(picked: string) {
    setVersion(picked);
    if (!picked || picked === told) return;
    setTold(picked);
    await invoke("select_install", { version: picked });
    announceBuildChanged();
  }

  const back =
    step === 0
      ? undefined
      : () => {
          setError("");
          setStep(step - 1);
        };
  const common = { busy, error, onBack: back, onContinue: () => void advance() };

  if (step === 0) {
    return (
      <StepFrame
        {...common}
        action="Get started"
        title={
          <span className="flex flex-wrap items-center gap-sm">
            Welcome to
            <BrandLogo className="h-[1.1em] w-auto" />
            {APP_NAME}
          </span>
        }
        body={
          <>
            A blazing fast, local alternative to Houdini’s docs. Made for power-users. This setup will take less than a minute.
            Repeatedly press <Keycap className="px-xs py-thin text-caption">Enter</Keycap> to skip.
          </>
        }
      />
    );
  }

  if (step === 1) {
    return (
      <StepFrame
        {...common}
        // The app reads nothing without a build, so no build, no way on.
        ready={Boolean(version)}
        step={1}
        action="Continue"
        title="Choose your Houdini install"
        body={`${APP_NAME} reads the documentation from the build you select. You can switch between them at any time from the sidebar.`}
      >
        <InstallStep
          value={version}
          onChange={(picked) => void choose(picked).catch((reason) => setError(String(reason)))}
          onError={setError}
        />
      </StepFrame>
    );
  }

  if (step === 2) {
    return (
      <StepFrame
        {...common}
        step={2}
        action={skipsHook ? "Skip for now" : "Continue"}
        title="Integrate inside Houdini"
        body={`Set ${APP_NAME} as the default help server for this install. Press F1 or the “Get Help” button on any node, and ${APP_NAME} appears directly inside Houdini, on that page.`}
        media={
          <img
            src={HELP_PANE_PICTURE}
            alt={`${APP_NAME} open in Houdini's help pane, on the Box node's page`}
            className="-mx-ms w-auto scale-150 origin-top-left"
          />
        }
      >
        <SettingRow
          label={`Set ${APP_NAME} as the default help server`}
          detail={version ? `Houdini ${version}` : undefined}
          checked={hookOn}
          onChange={setHookOn}
        />
        {skipsHook && (
          <p className="text-meta text-neutral-500">
            Houdini is open. Close it to set the help server, or skip and set it later from the F1 key in the sidebar.
          </p>
        )}
      </StepFrame>
    );
  }

  if (step === 3) {
    return (
      <StepFrame
        {...common}
        step={3}
        action="Continue"
        title="Connect your AI agent"
        body="Houdini MCP connects your agent to Houdini and to these docs. Ask it to pull the docs, and it walks them on its own, for the exact build you use."
        media={
          <img
            src={MCP_PICTURE}
            alt="Claude, ChatGPT and Gemini marks linked to the Houdini mark"
            className="size-full object-cover"
          />
        }
      >
        <McpStep on={mcpOn} onToggle={setMcpOn} agent={agent} onAgent={setAgent} onScanned={setAgentsFound} />
      </StepFrame>
    );
  }

  if (step === 4) {
    return (
      <StepFrame
        {...common}
        step={4}
        action="Continue"
        title="Help fix what breaks"
        body={
          <>
            {APP_NAME} sends this, and nothing else, under a random number made on this machine: your Houdini build, your
            operating system, how long the index takes, how long a page takes to open, crash and error messages, the answers
            you give on this setup, the names of the parts of the app you use, for a search, how many results came back
            and which one you opened, and a signal once an hour that the app is running.
            <br />
            <br />
            <strong>Never your search words, page titles, file paths or user name.</strong> You can read every line that
            leaves this machine: the app name in the title bar has “See what is sent”.
          </>
        }
      >
        <SettingRow
          label="Send anonymous usage data"
          checked={telemetryOn}
          onChange={setTelemetryOn}
        />
      </StepFrame>
    );
  }

  return (
    <StepFrame
      {...common}
      step={5}
      action="Continue"
      title="Heads up: this is a beta"
      body="Expect bugs. Bookmarks, recent pages and the index can be lost between builds. Some pages can miss content, or render incorrectly. File an issue using the button in the sidebar or directly on GitHub."
    >
      <p className="text-caption text-neutral-400">
        The documentation is © SideFX. {APP_NAME} only presents it. This is an unofficial project, not affiliated with or endorsed
        by SideFX.
      </p>
    </StepFrame>
  );
}

/**
 * Whether the reader has been through the first launch, and how to say they
 * have. `null` while the answer is still being read, so the window shows
 * neither the app nor the setup for that moment rather than flashing one.
 */
export function useOnboarding(): { show: boolean | null; finish: () => void } {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    // Houdini's help pane is not a first launch. It is the same front end
    // served over HTTP, in a window the reader opened from inside Houdini,
    // and the setup belongs to the desktop app that owns the settings.
    if (!inTauri) {
      setShow(false);
      return;
    }
    let live = true;
    void invoke<string | null>("get_setting", { key: ONBOARDED })
      .catch(() => "done")
      .then((answer) => {
        if (live) setShow(answer !== "done");
      });
    return () => {
      live = false;
    };
  }, []);

  return {
    show,
    finish: () => setShow(false),
  };
}
