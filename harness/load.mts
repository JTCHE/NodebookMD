/**
 * THE MACHINE THE APP ACTUALLY RUNS ON: ONE THAT IS ALREADY BUSY.
 *
 * The whole point of this product is that it stays fast while Houdini cooks.
 * So every number the harness takes on a quiet machine is half an answer, and
 * this file supplies the other half: a real Houdini cook, running the whole
 * time the measurements are repeated.
 *
 * It is `hython` and not the Houdini MCP server, which has not connected on
 * this machine since 27 Aug 2026 — see the spec. `hython` needs no window and
 * no plugin, and it cooks with the same engine an artist's session does.
 *
 * A machine with no free licence, or no Houdini at all, gets the second load:
 * one thread per core burning arithmetic, plus a block of memory. That is a
 * weaker test — no disk pressure and no Houdini scheduler — so the report says
 * which of the two ran.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Cooks, forever, until the process is killed. Points enough to keep every
 *  core busy on a workstation, in a loop so the cook never simply finishes. */
const COOK = `import hou

geo = hou.node("/obj").createNode("geo", "load")
box = geo.createNode("box")
scatter = geo.createNode("scatter")
scatter.setInput(0, box)
scatter.parm("npts").set(3000000)
wrangle = geo.createNode("attribwrangle")
wrangle.setInput(0, scatter)
wrangle.parm("snippet").set("@P += noise(@P * 4.0) * 0.01; @Cd = noise(@P * 8.0);")
print("cooking", flush=True)
while True:
    wrangle.cook(force=True)
`;

export interface Load {
  /** "houdini" or "arithmetic" — the report says which one the numbers stand on. */
  kind: string;
  stop(): void;
}

/** The newest Houdini on this machine, or nothing. */
function hython(): string | null {
  const roots = [
    "C:/Program Files/Side Effects Software",
    "C:/Program Files (x86)/Side Effects Software",
  ];
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const exe = join(root, name, "bin", "hython.exe");
      if (existsSync(exe)) found.push(exe);
    }
  }
  return found.sort().at(-1) ?? null;
}

/** Arithmetic on every core, and a gigabyte held, for a machine with no
 *  Houdini to cook with. */
function burn(): ChildProcess {
  const script = `
const os = require("node:os");
const { Worker, isMainThread } = require("node:worker_threads");
if (isMainThread) {
  const held = Buffer.alloc(1024 * 1024 * 1024, 7);
  // Two cores are left alone. Every core burning at normal priority is not a
  // busy machine, it is a starved one: on the eight-thread reference laptop the
  // app never drew its search field again, and the run reported nothing at all
  // instead of reporting a slow number. Houdini leaves the machine usable, and
  // so does this.
  for (let i = 0; i < Math.max(1, os.cpus().length - 2); i++) new Worker(__filename);
  setInterval(() => held[0]++, 1000);
} else {
  let x = 0;
  for (;;) x = Math.sin(x) + Math.sqrt(x + 1);
}
`;
  const file = join(mkdtempSync(join(tmpdir(), "nodebookmd-load-")), "burn.cjs");
  writeFileSync(file, script);
  return spawn(process.execPath, [file], { stdio: "ignore" });
}

/** Starts the load and waits until it is really running. */
export async function startLoad(): Promise<Load> {
  const exe = hython();
  if (exe) {
    const file = join(mkdtempSync(join(tmpdir(), "nodebookmd-cook-")), "cook.py");
    writeFileSync(file, COOK);
    const child = spawn(exe, [file], { stdio: ["ignore", "pipe", "pipe"] });
    const cooking = await new Promise<boolean>((resolve) => {
      // The script prints once the scene is built. Until then hython is only
      // starting up, which is not the load this test is about.
      const timer = setTimeout(() => resolve(false), 120_000);
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("cooking")) {
          clearTimeout(timer);
          resolve(true);
        }
      });
      // A machine with no licence says so at once. Waiting out the timeout for
      // an answer already given wastes a minute of every run.
      child.stderr.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("No licenses")) {
          clearTimeout(timer);
          resolve(false);
        }
      });
      child.on("exit", () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
    if (cooking) {
      return { kind: "houdini", stop: () => void child.kill("SIGKILL") };
    }
    // No licence, or a version that cannot build the scene. Say so and fall
    // back rather than reporting a load test that never loaded anything.
    child.kill("SIGKILL");
    console.error("hython did not start cooking — falling back to arithmetic load");
  }
  const child = burn();
  await new Promise((r) => setTimeout(r, 3000));
  return { kind: "arithmetic", stop: () => void child.kill("SIGKILL") };
}
