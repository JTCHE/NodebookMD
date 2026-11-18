import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CornerLeftUp, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION, ACTION_ICON, QUIET } from "@/lib/ui/button";
import { Hint } from "@/components/ui/Hint";
import { invoke, inTauri } from "@/lib/backend";
import { showToast } from "@/components/ui/toast-notification";
import { used } from "@/lib/telemetry";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { titleOf, warmTitleIndex } from "@/lib/search";

/** The page an example is for: the folder it sits in, as in Houdini's own
    help. `examples/nodes/sop/divide/X` is for `nodes/sop/divide`. The engine
    reads it the same way (`listing.rs`, `example_for`). */
export function exampleFor(path: string): string | null {
  if (!path.startsWith("examples/")) return null;
  const folder = path.slice("examples/".length, path.lastIndexOf("/"));
  return folder.includes("/") ? folder : null;
}

/** A button beside Launch that goes up to the page the example is for, once
    the title list has that page. */
export function ExampleFor({ path }: { path: string }) {
  const target = exampleFor(path);
  const [title, setTitle] = useState(() => target && titleOf(target));
  useEffect(() => {
    if (!target) return;
    let live = true;
    void warmTitleIndex().then(() => live && setTitle(titleOf(target)));
    return () => {
      live = false;
    };
  }, [target]);
  if (!target || !title) return null;
  return (
    <Hint label={`This example is for ${title}`}>
      <Link to={`/${target}`} className={cn(ACTION, QUIET, "no-underline")}>
        <CornerLeftUp className={ACTION_ICON} aria-hidden="true" />
        {title}
      </Link>
    </Hint>
  );
}

/**
 * Opens an example page's file in a new Houdini, the same as the Launch
 * button in Houdini's own help. A new Houdini, not the open one: the reader's
 * scene is never touched. Drawn only when the install has the file.
 */
export function LaunchExample({ path }: { path: string }) {
  const [has, setHas] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!inTauri || !path.startsWith("examples/")) return;
    let live = true;
    void invoke<boolean>("has_example", { path })
      .then((found) => live && setHas(found))
      .catch(() => {});
    return () => {
      live = false;
      setHas(false);
    };
  }, [path]);

  if (!has) return null;
  return (
    <PrimaryButton
      disabled={starting}
      onClick={() => {
        used("launch-example");
        setStarting(true);
        invoke("launch_example", { path })
          .then(() => showToast("Houdini is starting with the example"))
          .catch((reason) => showToast(String(reason)))
          // Houdini takes its time to show a window. The button waits a moment
          // so a second press does not start a second Houdini.
          .finally(() => setTimeout(() => setStarting(false), 4000));
      }}
      className={cn(ACTION, "py-0 disabled:opacity-60")}
    >
      <Play className={ACTION_ICON} aria-hidden="true" />
      {starting ? "Starting…" : "Launch in Houdini"}
    </PrimaryButton>
  );
}
