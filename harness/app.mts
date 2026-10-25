/**
 * THE SHIPPED BINARY, DRIVEN THROUGH THE READER'S FLOWS, WITH ITS MEMORY AND
 * PROCESSOR TIME WATCHED THE WHOLE WAY.
 *
 *   node harness/app.mts             # a normal launch, on a copy of the real data
 *   node harness/app.mts --clean     # a first launch: empty data, full index pass
 *   node harness/app.mts --no-build  # reuse target/release/nodebookmd.exe
 *   node harness/app.mts --exe <path> # another build, to compare two
 *
 * The number a reader sees is Task Manager's "Memory" column: the PRIVATE
 * WORKING SET of `nodebookmd.exe`. The webview is a separate tree of
 * `msedgewebview2.exe` processes and is reported beside it, never added in.
 *
 * The app runs from a copy in a temporary folder with a `.portable` marker, so
 * it reads and writes a copy of the reader's data and never the real one. The
 * webview gets its own profile folder for the same reason. The update check
 * is switched off in that copy: a newer release would install over the real
 * app. Telemetry goes to a sink on this machine, not to the internet — but it
 * is still sent, because the client that sends it is part of what is measured.
 *
 * The window is driven over the webview's own debugging port
 * (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`), so every page open, search and
 * hide below is the real app doing it, not the stub `probe --serve` answers.
 *
 * A sampler polls the process tree every 250ms for the whole run. Each step
 * then reports the memory at its end and what the step added, so a jump points
 * at the step that caused it.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as httpServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const at = process.argv.indexOf("--exe");
const EXE = at > 0 ? process.argv[at + 1] : "src-tauri/target/release/nodebookmd.exe";
/** The Windows temp folder. Git Bash hands node a `TEMP` Windows cannot use,
 *  and PowerShell's `Add-Type` then tries to compile into C:\Windows. */
const TEMP = join(homedir(), "AppData", "Local", "Temp");
const OUT = "harness/out";

/* ─────────────────────────────── the sampler ─────────────────────────────── */

export interface Sample {
  /** Milliseconds since launch. */
  at: number;
  /** Private working set of `nodebookmd.exe`, MB: Task Manager's number. */
  app: number;
  /** Private bytes committed by `nodebookmd.exe`, MB, in memory or not. */
  commit: number;
  /** Processor seconds `nodebookmd.exe` has used since it started. */
  cpu: number;
  threads: number;
  handles: number;
  /** Private working set of every webview process the app started, MB. */
  webview: number;
  webviewProcesses: number;
  priority: string;
}

/**
 * One PowerShell that stays up and prints a line of JSON every tick.
 * `PrivateWorkingSetSize` comes from `PROCESS_MEMORY_COUNTERS_EX2`, which is
 * what Task Manager reads; .NET's `Process` does not expose it.
 */
const SAMPLER = String.raw`
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Mem {
  [StructLayout(LayoutKind.Sequential)] public struct C {
    public uint cb; public uint faults;
    public UIntPtr peakWs, ws, qpp, qp, qpnp, qnp, pagefile, peakPagefile, priv, privWs;
    public ulong sharedCommit;
  }
  [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr h, out C c, uint cb);
  public static ulong[] Read(IntPtr h) {
    C c; c.cb = (uint)Marshal.SizeOf(typeof(C));
    if (!GetProcessMemoryInfo(h, out c, c.cb)) return new ulong[] { 0, 0 };
    return new ulong[] { (ulong)c.privWs, (ulong)c.priv };
  }
}
"@
$root = [int]$args[0]; $t0 = Get-Date
while ($true) {
  $p = Get-Process -Id $root -ErrorAction SilentlyContinue
  if (-not $p) { break }
  $m = [Mem]::Read($p.Handle)
  $all = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -Property ProcessId,ParentProcessId
  $tree = @{ $root = $true }; $web = @()
  do { $grew = $false
    foreach ($w in $all) { if ($tree[[int]$w.ParentProcessId] -and -not $tree[[int]$w.ProcessId]) { $tree[[int]$w.ProcessId] = $true; $web += $w.ProcessId; $grew = $true } }
  } while ($grew)
  $webWs = 0
  foreach ($id in $web) { $q = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($q) { $webWs += ([Mem]::Read($q.Handle))[0] } }
  [Console]::Out.WriteLine((@{ at = [int]((Get-Date) - $t0).TotalMilliseconds; app = $m[0]; commit = $m[1]; cpu = $p.TotalProcessorTime.TotalSeconds; threads = $p.Threads.Count; handles = $p.HandleCount; webview = $webWs; webviewProcesses = $web.Count; priority = "$($p.PriorityClass)" } | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 250
}
`;

const MB = 1024 * 1024;

function startSampler(pid: number) {
  const samples: Sample[] = [];
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", `& {${SAMPLER}} ${pid}`], {
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, TEMP, TMP: TEMP },
  });
  let rest = "";
  child.stdout.on("data", (chunk: Buffer) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      const raw = JSON.parse(line);
      samples.push({ ...raw, app: raw.app / MB, commit: raw.commit / MB, webview: raw.webview / MB });
    }
  });
  return {
    samples,
    /** The next sample taken after this call, so a step's number is its own. */
    async next(): Promise<Sample> {
      const have = samples.length;
      while (samples.length <= have) {
        if (child.exitCode !== null) throw new Error("the sampler stopped");
        await sleep(50);
      }
      return samples.at(-1)!;
    },
    stop: () => child.kill(),
  };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/* ─────────────────────────────── the launch ─────────────────────────────── */

/** Counts what the app would have sent. Nothing leaves the machine. */
function telemetrySink(): Promise<{ server: Server; url: string; count: () => number }> {
  let count = 0;
  const server = httpServer((request, response) => {
    count += 1;
    request.resume();
    response.end("{}");
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      done({ server, url: `http://127.0.0.1:${port}/v1/event`, count: () => count });
    }),
  );
}

/** The reader's data folder, the one `update::data_dir` names. */
const dataAt = process.argv.indexOf("--data");
/** Where the staged copy's index and settings come from: the reader's own, or
 *  `--data <dir>`. An index written by a newer build is thrown away and built
 *  again by an older one, and that pass is then what gets measured. */
const DATA = dataAt > 0 ? process.argv[dataAt + 1] : join(homedir(), "AppData", "Roaming", "com.nodebookmd.app");

/**
 * A portable copy of the app, on a copy of the reader's data (or none, with
 * `clean`). Returns the folder.
 */
/** Into the Recycle Bin, never deleted: the copy of the index is large. */
export function recycle(dir: string) {
  // A file held open keeps the folder, and the call says nothing: a webview
  // that has not yet let go, or a contact sheet open in a browser. Old frames
  // then sat beside new ones and read as the new run. Try again, then fail.
  // Ten seconds was too short for a killed app after a long film; the same
  // call passed a minute later.
  for (let tries = 0; tries < 30 && existsSync(dir); tries += 1) {
    spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      `Start-Sleep 1; Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${dir}', 'OnlyErrorDialogs', 'SendToRecycleBin')`,
    ]);
  }
  if (existsSync(dir)) throw new Error(`could not move ${dir} to the Recycle Bin; is a file in it open?`);
}

/**
 * One fixed folder, not a new one per run: the app listens on the network
 * (`bind` in `server.rs`), and Windows Firewall asks about each new path of
 * the exe. The same path is asked about once.
 */
function stage(clean: boolean): string {
  const dir = join(TEMP, "nodebookmd-harness");
  if (existsSync(dir)) recycle(dir);
  mkdirSync(dir);
  copyFileSync(EXE, join(dir, "nodebookmd.exe"));
  writeFileSync(join(dir, ".portable"), "");
  if (!clean) {
    for (const file of ["index.db", "index.db-wal", "user.db"]) {
      if (existsSync(join(DATA, file))) copyFileSync(join(DATA, file), join(dir, file));
    }
  }
  const user = new DatabaseSync(join(dir, "user.db"));
  user.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const set = user.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  // No update check: a newer release would install over the reader's own app.
  set.run("auto_update", "0");
  set.run("onboarded", "done");
  // A first launch has no answer yet; say yes so the sending is measured.
  set.run("telemetry", "true");
  user.close();
  return dir;
}

export interface Running {
  pid: number;
  /** The port of this process's own help server (`server.rs`), the one F1 opens. */
  port: number;
  page: Page;
  dir: string;
  stop(): Promise<void>;
}

/**
 * Starts the app from a staged folder and attaches to its window. Waits for
 * an already-running release NodebookMD to close first: it holds the
 * single-instance lock, and a second launch would only hand over to it. It is
 * not stopped: it is the reader's own app, or another session's. A debug
 * build takes no lock (`run` in `lib.rs`), so it is left alone.
 */
export async function launch(options: { clean?: boolean; telemetry?: string; env?: Record<string, string> } = {}): Promise<Running> {
  const running = () =>
    spawnSync("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Process -Filter \"Name='nodebookmd.exe'\").ExecutablePath"], { encoding: "utf8" })
      .stdout.split(/\r?\n/)
      .some((exe) => exe.trim() && !/\\target\\debug\\/i.test(exe));
  if (running()) console.error("# waiting for the NodebookMD that is already running to close");
  for (const give = Date.now() + 30 * 60_000; running(); await sleep(5000)) {
    if (Date.now() > give) throw new Error("another NodebookMD is still running; close it and run again");
  }
  const dir = stage(!!options.clean);
  // A panic prints here before the app aborts; the error below quotes it.
  const stderr = join(dir, "stderr.log");
  const errors = openSync(stderr, "w");
  // `--background`, as Houdini starts it: the window is never shown, so it
  // never takes the foreground (tao's `set_focus` sends an Alt press to get
  // it). The page still draws: the webview is told not to stop a hidden one.
  const child: ChildProcess = spawn(join(dir, "nodebookmd.exe"), ["--background", ...(options.clean ? ["--clean"] : [])], {
    cwd: dir,
    stdio: ["ignore", "ignore", errors],
    env: {
      ...process.env,
      TEMP,
      TMP: TEMP,
      WEBVIEW2_USER_DATA_FOLDER: join(dir, "webview"),
      // Port 0: the webview picks its own and writes it to DevToolsActivePort.
      // A port picked here first can fall in a range Hyper-V reserves, and
      // then the webview opens no port at all and says nothing.
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=0 --disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows",
      NODEBOOKMD_TELEMETRY_URL: options.telemetry ?? "http://127.0.0.1:9/v1/event",
      ...options.env,
    },
  });
  // The app has its own handle now. Held here too, the file kept the folder
  // out of the Recycle Bin until this process ended.
  closeSync(errors);
  const pid = child.pid!;
  let browser: Browser | null = null;
  async function stop() {
    await browser?.close().catch(() => {});
    child.kill();
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    recycle(dir);
  }
  try {
    const portFile = join(dir, "webview", "EBWebView", "DevToolsActivePort");
    let cdp = "";
    for (let tries = 0; tries < 120 && !browser; tries += 1) {
      cdp = existsSync(portFile) ? readFileSync(portFile, "utf8").split("\n")[0].trim() : "";
      if (cdp) browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`).catch(() => null);
      if (!browser) await sleep(250);
    }
    if (!browser) throw new Error("the app's webview never opened its debugging port");
    let page: Page | undefined;
    for (let tries = 0; tries < 120 && !page; tries += 1) {
      page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("tauri.localhost"));
      if (!page) await sleep(250);
    }
    if (!page) {
      const targets = await fetch(`http://127.0.0.1:${cdp}/json/list`).then((r) => r.text()).catch(String);
      throw new Error(`no app page in the webview (app exit ${child.exitCode}); port ${cdp} lists ${targets}`);
    }
    await page.waitForLoadState("load");
    // Asked of this process, not found by a scan of 48800 and up: another
    // NodebookMD (a debug build, the reader's own) can hold the first port.
    const port = (await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("server_port"))) as number;
    if (!port) throw new Error("the app's help server did not start");
    return { pid, port, page, dir, stop };
  } catch (error) {
    const said = existsSync(stderr) ? readFileSync(stderr, "utf8").slice(-2000) : "";
    await stop();
    throw new Error(`${(error as Error).message}\n--- app stderr ---\n${said}`);
  }
}

/* ─────────────────────────────── the flows ─────────────────────────────── */

type Invoke = (command: string, args?: object) => Promise<unknown>;
declare global {
  interface Window {
    __TAURI_INTERNALS__: { invoke: Invoke };
  }
}

/** Waits until the article heading is a different one than `before`. */
async function headingChanged(page: Page, before: string | null) {
  await page.waitForFunction(
    (was) => {
      const text = document.querySelector("article.prose h1")?.textContent?.trim() ?? null;
      return text !== null && text !== was;
    },
    before,
    { timeout: 20_000 },
  );
}

async function heading(page: Page): Promise<string | null> {
  return page.evaluate(() => document.querySelector("article.prose h1")?.textContent?.trim() ?? null);
}

/** Opens `count` pages spread over the whole install, one after another, by
 *  route — the router does the same work a click does. */
async function openPages(page: Page, count: number) {
  const paths = await page.evaluate(async (want) => {
    // Not the page on screen: the app opens on the last page read, and a route
    // to the page already drawn draws nothing new to wait for.
    const all = ((await window.__TAURI_INTERNALS__.invoke("titles")) as { path: string }[]).filter(
      (hit) => hit.path !== location.pathname,
    );
    const step = Math.max(1, Math.floor(all.length / want));
    return all.filter((_, i) => i % step === 0).slice(0, want).map((hit) => hit.path.replace(/^\//, ""));
  }, count);
  for (const path of paths) {
    const before = await heading(page);
    await page.evaluate((to) => {
      history.pushState({}, "", `/${to}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, path);
    await headingChanged(page, before).catch(async () => {
      const at = await page.evaluate(() => `${location.pathname}, heading ${JSON.stringify(document.querySelector("article.prose h1")?.textContent ?? null)}`);
      console.error(`# ${path} never drew (was ${JSON.stringify(before)}; now at ${at})`);
    });
  }
}

/**
 * WHAT A READER WAITS FOR, IN THE SHIPPED WINDOW.
 *
 * Each time runs from the input event's own `timeStamp` — the moment the
 * webview received the press or the key — to the second frame after the new
 * heading is in the page, which is the frame a reader sees. Nothing of the
 * driver's own round trip is in it.
 *
 * - `route`: an address change made by script, the router's share alone.
 * - `press`: a real press on a link in the page, the number a reader feels.
 * - `tab_open`: Ctrl+Shift+press on a link, drawn in a new tab.
 * - `tab_switch`: Ctrl+Shift+Tab back to the tab before.
 */
const TIMED = 12;

/** Starts a stopwatch at the next pointer press or key press, and stops it
    two frames after the article heading changes. */
async function stopwatch(page: Page): Promise<() => Promise<number | null>> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__from = null;
    w.__was = document.querySelector("article.prose h1")?.textContent?.trim() ?? null;
    const start = (event: Event) => {
      if (w.__from === null) w.__from = event.timeStamp;
    };
    addEventListener("pointerdown", start, { capture: true, once: true });
    addEventListener("keydown", start, { capture: true, once: true });
    w.__start = start;
  });
  return () =>
    page.evaluate(
      () =>
        new Promise<number | null>((done) => {
          const w = window as unknown as Record<string, unknown>;
          const give = performance.now() + 10_000;
          const tick = () => {
            const text = document.querySelector("article.prose h1")?.textContent?.trim() ?? null;
            if (w.__from !== null && text !== null && text !== w.__was) {
              requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - (w.__from as number))));
              return;
            }
            if (performance.now() > give) return done(null);
            requestAnimationFrame(tick);
          };
          tick();
        }),
    );
}

/** A link in the article to another page, at a point the pointer can press. */
async function linkInPage(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const link = [...document.querySelectorAll<HTMLAnchorElement>("article a[href^='/']")].find((a) => {
      const box = a.getBoundingClientRect();
      const href = a.getAttribute("href") ?? "";
      return box.width > 0 && box.top > 60 && box.bottom < innerHeight - 20 && href.split("#")[0] !== location.pathname;
    });
    if (!link) return null;
    const box = link.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
}

export type Timings = Record<"route" | "press" | "tab_open" | "tab_switch", number[]>;

async function timeFlows(page: Page): Promise<Timings> {
  const out: Timings = { route: [], press: [], tab_open: [], tab_switch: [] };
  const paths = await page.evaluate(async (want) => {
    const all = (await window.__TAURI_INTERNALS__.invoke("titles")) as { path: string }[];
    const step = Math.max(1, Math.floor(all.length / want));
    return all.filter((_, i) => i % step === 0).slice(0, want).map((hit) => hit.path.replace(/^\//, ""));
  }, TIMED);
  for (const path of paths) {
    // Route: the stopwatch starts on the script's own stamp.
    const before = await heading(page);
    const routed = await page.evaluate(
      ([to, was]) =>
        new Promise<number | null>((done) => {
          const from = performance.now();
          history.pushState({}, "", `/${to}`);
          dispatchEvent(new PopStateEvent("popstate"));
          const give = from + 10_000;
          const tick = () => {
            const text = document.querySelector("article.prose h1")?.textContent?.trim() ?? null;
            if (text !== null && text !== was) return requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now() - from)));
            if (performance.now() > give) return done(null);
            requestAnimationFrame(tick);
          };
          tick();
        }),
      [path, before] as [string, string | null],
    );
    if (routed !== null) out.route.push(routed);
    await sleep(300);

    // Press: a reader's pointer crosses the link, then presses.
    let link = await linkInPage(page);
    if (link) {
      await page.mouse.move(link.x, link.y);
      await sleep(60);
      const stop = await stopwatch(page);
      await page.mouse.down();
      await page.mouse.up();
      const pressed = await stop();
      if (pressed !== null) out.press.push(pressed);
      await sleep(300);
    }

    // A new tab in front, then back to the tab before, then close the new one.
    link = await linkInPage(page);
    if (link) {
      await page.mouse.move(link.x, link.y);
      await page.keyboard.down("Control");
      await page.keyboard.down("Shift");
      const stop = await stopwatch(page);
      await page.mouse.click(link.x, link.y);
      await page.keyboard.up("Shift");
      await page.keyboard.up("Control");
      const opened = await stop();
      if (opened !== null) {
        out.tab_open.push(opened);
        await sleep(300);
        const back = await stopwatch(page);
        await page.keyboard.press("Control+Shift+Tab");
        const switched = await back();
        if (switched !== null) out.tab_switch.push(switched);
        await page.keyboard.press("Control+Tab");
        await page.keyboard.press("Control+w");
      }
      await sleep(300);
    }
  }
  return out;
}

const QUERIES = ["copy to points", "pyro", "noise", "attribute wrangle", "vellum", "hou.node", "for each", "rbd", "usd", "karma"];

/** Types each query into the search overlay, waits for its rows, closes it. */
async function search(page: Page) {
  for (const query of QUERIES) {
    await page.keyboard.press("Control+k");
    await page.keyboard.type(query, { delay: 30 });
    await page.waitForSelector("li[data-row]", { timeout: 10_000 }).catch(() => console.error(`# no rows for ${query}`));
    await page.keyboard.press("Escape");
  }
}

interface Step {
  name: string;
  note: string;
  run: (running: Running) => Promise<void>;
}

const STEPS: Step[] = [
  { name: "started", note: "the window is up", run: async () => {} },
  { name: "settled", note: "20 s later: index pass and page catalog done", run: async () => sleep(20_000) },
  { name: "one_page", note: "one page open", run: async ({ page }) => openPages(page, 1) },
  {
    name: "timed",
    note: `${TIMED} pages by route, by press, in a new tab, and back`,
    run: async ({ page }) => {
      timings = await timeFlows(page);
    },
  },
  { name: "fifty_pages", note: "49 more pages", run: async ({ page }) => openPages(page, 49) },
  { name: "searched", note: "10 searches typed in the overlay", run: async ({ page }) => search(page) },
  {
    name: "hidden",
    note: "window closed to the tray, 10 s later",
    run: async ({ page }) => {
      await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("close_window")).catch(() => {});
      await sleep(10_000);
    },
  },
  { name: "idle", note: "hidden, 30 s more", run: async () => sleep(30_000) },
];

/** Filled by the `timed` step. */
let timings: Timings = { route: [], press: [], tab_open: [], tab_switch: [] };

export interface StepResult {
  name: string;
  note: string;
  sample: Sample;
  /** Peak private working set during the step. */
  peak: number;
  /** The page's JavaScript heap in use, MB. The rest of the webview's number
   *  is the engine: decoded pictures, layers, the GPU process. */
  jsHeap: number;
}

export interface Audit {
  clean: boolean;
  steps: StepResult[];
  samples: Sample[];
  /** Processor time over the `idle` step, as a share of one core. */
  idleCores: number;
  telemetrySent: number;
  timings: Timings;
}

export async function auditApp(options: { clean?: boolean } = {}): Promise<Audit> {
  if (!existsSync(EXE)) throw new Error(`no ${EXE} — run \`bun run app:build\` first`);
  const sink = await telemetrySink();
  const running = await launch({ clean: options.clean, telemetry: sink.url });
  const sampler = startSampler(running.pid);
  const cdp = await running.page.context().newCDPSession(running.page);
  const steps: StepResult[] = [];
  try {
    let from = 0;
    for (const step of STEPS) {
      await step.run(running);
      const sample = await sampler.next();
      const during = sampler.samples.slice(from);
      from = sampler.samples.length;
      const heap = (await cdp.send("Runtime.getHeapUsage").catch(() => ({ usedSize: 0 }))) as { usedSize: number };
      steps.push({ name: step.name, note: step.note, sample, peak: Math.max(...during.map((s) => s.app)), jsHeap: heap.usedSize / MB });
      console.error(`# ${step.name}: ${sample.app.toFixed(1)} MB`);
    }
  } finally {
    sampler.stop();
    await running.stop();
    sink.server.close();
  }
  const idle = steps.at(-1)!.sample;
  const hidden = steps.at(-2)!.sample;
  return {
    clean: !!options.clean,
    steps,
    samples: sampler.samples,
    idleCores: (idle.cpu - hidden.cpu) / ((idle.at - hidden.at) / 1000),
    telemetrySent: sink.count(),
    timings,
  };
}

/* ─────────────────────────────── the report ─────────────────────────────── */

const r1 = (n: number) => Math.round(n * 10) / 10;

export function auditMarkdown(audit: Audit): string {
  let md = `## App, ${audit.clean ? "first launch" : "normal launch"}\n\n`;
  md += `Private working set of \`nodebookmd.exe\` (Task Manager's number) at the end of each step. `;
  md += `The webview is its own processes, beside it.\n\n`;
  md += `| step | app MB | added | peak | commit MB | threads | handles | webview MB | JS heap MB | webview procs | what |\n`;
  md += `| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |\n`;
  let last = 0;
  for (const step of audit.steps) {
    const s = step.sample;
    md += `| ${step.name} | ${r1(s.app)} | ${last ? (s.app - last >= 0 ? "+" : "") + r1(s.app - last) : "–"} | ${r1(step.peak)} | ${r1(s.commit)} | ${s.threads} | ${s.handles} | ${r1(s.webview)} | ${r1(step.jsHeap)} | ${s.webviewProcesses} | ${step.note} |\n`;
    last = s.app;
  }
  md += `\n| flow | median ms | worst ms | runs |\n| --- | ---: | ---: | ---: |\n`;
  for (const [name, all] of Object.entries(audit.timings)) {
    const sorted = [...all].sort((a, b) => a - b);
    md += `| ${name} | ${sorted.length ? r1(sorted[sorted.length >> 1]) : "–"} | ${sorted.length ? r1(sorted.at(-1)!) : "–"} | ${sorted.length} |\n`;
  }
  md += `\nIdle: ${r1(audit.idleCores * 100)}% of one core. Priority ${audit.steps[0].sample.priority}. `;
  md += `${audit.telemetrySent} telemetry request(s) went to the local sink.\n`;
  // The curve, so a slow climb shows that a table of steps would hide.
  const points = audit.samples.filter((_, i) => i % 4 === 0);
  const top = Math.max(...points.map((s) => s.app));
  const bars = " ▁▂▃▄▅▆▇█";
  md += `\n\`${points.map((s) => bars[Math.round((s.app / top) * 8)]).join("")}\` 0–${r1(top)} MB, one mark a second\n`;
  return md;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--no-build") && !args.includes("--exe")) {
    const build = spawnSync("bun", ["run", "app:build"], { stdio: "inherit", shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const audit = await auditApp({ clean: args.includes("--clean") });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/app.json`, `${JSON.stringify(audit, null, 2)}\n`);
  const md = auditMarkdown(audit);
  writeFileSync(`${OUT}/app.md`, md);
  console.log(md);
}

if (resolve(process.argv[1] ?? "") === resolve("harness/app.mts")) await main();
