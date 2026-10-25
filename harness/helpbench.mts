/**
 * F1 IN HOUDINI, TWO SERVERS: SIDEFX'S OWN HELP SERVER AGAINST THIS APP'S.
 *
 *   node harness/helpbench.mts                  # build, measure, report
 *   node harness/helpbench.mts --no-build --runs 7
 *   node harness/helpbench.mts --chart          # also draw public/help-server-benchmark.png
 *
 * The same pages, off the two servers, in the same browser, made to behave
 * like Houdini's help pane (Chromium 108, `shimPane` from `pane.mts`).
 *
 *   sidefx     Houdini's own help server. The one a running Houdini has on
 *              48626 when it answers; otherwise `hhelp serve` from the newest
 *              install, which runs the same `hwebserver` Houdini runs.
 *   nodebookmd the shipped binary, from a staged copy on a copy of the
 *              reader's data (`launch` in `app.mts`), so its index is warm.
 *
 * Houdini's pane is not driven. It is QtWebEngine inside Houdini and has no
 * debugging port unless Houdini is started with one, so the pane is recreated
 * instead and the servers are real. What that leaves out is Qt's own cost,
 * which both servers pay the same.
 *
 * Three presses per page, because they are three different waits:
 *
 *   first    the first time the server is asked for that page since it
 *            started — F1 right after opening Houdini. One sample each.
 *   cold     a new pane: nothing in the browser cache. The server is warm.
 *   repeat   the same pane pressing F1 again on a page it has shown.
 *
 * A press is filmed with the screencast, the way `slowmo.mts` films. `ready`
 * is the moment the frames reach 90% of the way to the final frame — the page
 * reads — and `complete` is the last frame that still changes. SideFX's page
 * shifts and fills its pictures in late, so the two numbers are far apart
 * there, and the gap is the point.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import sharp from "sharp";
import { buildAsciiField } from "../src/lib/landing/asciiField.ts";
import tauri from "../src-tauri/tauri.conf.json" with { type: "json" };
const { productName } = tauri;
import { launch } from "./app.mts";
import { CONFIRMED_CHROMIUM, detectInstalls, gapsFor, qtWebEngineVersion, shimPane } from "./pane.mts";

const OUT = "harness/out/helpbench";
/** The size of Houdini's help pane as it opens. */
const VIEW = { width: 1100, height: 760 };

/** A node, a long node, a VEX function, a shelf tool. Paths only. */
const PAGES = [
  { label: "Box", path: "nodes/sop/box" },
  { label: "Attribute Wrangle", path: "nodes/sop/attribwrangle" },
  { label: "Pyro Solver", path: "nodes/sop/pyrosolver" },
  { label: "VEX noise()", path: "vex/functions/noise" },
  { label: "FLIP Tank tool", path: "shelf/fliptank" },
];

type Press = "first" | "cold" | "repeat";

interface Sample {
  ttfb: number;
  fcp: number;
  /** 90% of the way from the blank frame to the final one, ms. */
  ready: number;
  /** The last frame that differs from the final one, ms. */
  complete: number;
  cls: number;
}

/* ─────────────────────────────── the servers ─────────────────────────────── */

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function answers(url: string, timeout = 1500): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(timeout) })).ok;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((done) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });
}

/** Houdini's help server: a running Houdini's, or a fresh `hhelp serve`. */
async function sidefxServer(): Promise<{ base: string; what: string; stop: () => void }> {
  if (await answers("http://127.0.0.1:48626/")) {
    return { base: "http://127.0.0.1:48626/", what: "a running Houdini's help server (port 48626)", stop: () => {} };
  }
  const install = detectInstalls().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (!install) throw new Error("no Houdini install to take `hhelp` from");
  const port = await freePort();
  const child: ChildProcess = spawn(`${install.root}\\bin\\hhelp.exe`, ["serve", "--host", "127.0.0.1", "--port", String(port), "--bgindex", "false"], {
    cwd: `${install.root}\\bin`,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/`;
  // The root page, not a measured one, so every measured page is still cold.
  for (let tries = 0; tries < 240 && !(await answers(base, 30_000)); tries += 1) await sleep(500);
  return { base, what: `\`hhelp serve\` from Houdini ${install.version} (hwebserver, as inside Houdini)`, stop: () => child.kill() };
}

/** This app's server, off a staged copy of the shipped binary. */
async function nodebookmdServer(): Promise<{ base: string; what: string; stop: () => Promise<void> }> {
  const running = await launch();
  return { base: `http://127.0.0.1:${running.port}/`, what: `${productName}'s server, the one F1 opens`, stop: running.stop };
}

/* ─────────────────────────────── one press ─────────────────────────────── */

/** Registered before any page script, so nothing is missed. */
const OBSERVE = `
window.__cls = 0;
new PerformanceObserver((list) => {
  for (const shift of list.getEntries()) if (!shift.hadRecentInput) window.__cls += shift.value;
}).observe({ type: "layout-shift", buffered: true });
`;

/** A small grey copy of a frame, for comparing frames by the numbers. */
const thumb = (jpeg: Buffer) => sharp(jpeg).resize(160, 110, { fit: "fill" }).greyscale().raw().toBuffer();

function distance(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

async function press(page: Page, url: string): Promise<Sample> {
  await page.goto("about:blank");
  const cdp = await page.context().newCDPSession(page);
  const frames: { at: number; data: Buffer }[] = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    frames.push({ at: (metadata.timestamp ?? Date.now() / 1000) * 1000, data: Buffer.from(data, "base64") });
    void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 });
  await sleep(150);
  const pressed = Date.now();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  // Film until nothing has been drawn for a second: late pictures, late
  // layout, a font. Capped, so a spinner cannot hold the run forever.
  const cap = Date.now() + 15_000;
  while (Date.now() < cap && Date.now() - (frames.at(-1)?.at ?? pressed) < 1000) await sleep(100);
  await cdp.send("Page.stopScreencast");
  await cdp.detach();

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    return { ttfb: nav.responseStart - nav.startTime, fcp, cls: (window as unknown as { __cls: number }).__cls };
  });

  const before = frames.filter((f) => f.at <= pressed).at(-1);
  const after = frames.filter((f) => f.at > pressed);
  const film = [...(before ? [before] : []), ...after];
  const thumbs = await Promise.all(film.map((f) => thumb(f.data)));
  const final = thumbs.at(-1)!;
  const span = distance(thumbs[0], final) || 1;
  let ready = 0;
  let complete = 0;
  for (let i = 1; i < film.length; i += 1) {
    const left = distance(thumbs[i], final);
    if (!ready && left <= span * 0.1) ready = film[i].at - pressed;
    if (left > 0.5) complete = (film[i + 1]?.at ?? film[i].at) - pressed;
  }
  return { ...timing, ready: ready || complete, complete: Math.max(complete, ready) };
}

/* ─────────────────────────────── the run ─────────────────────────────── */

async function context(browser: Browser, gaps: ReturnType<typeof gapsFor>): Promise<Page> {
  const page = await (await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 })).newPage();
  await shimPane(page, gaps);
  await page.addInitScript(OBSERVE);
  return page;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

type Results = Record<string, Record<string, Record<Press, Sample[]>>>;

async function measure(browser: Browser, base: string, runs: number, gaps: ReturnType<typeof gapsFor>) {
  const out: Record<string, Record<Press, Sample[]>> = {};
  for (const page of PAGES) out[page.label] = { first: [], cold: [], repeat: [] };
  // First: one pane, every page once, each the first the server has seen.
  const first = await context(browser, gaps);
  for (const page of PAGES) out[page.label].first.push(await press(first, base + page.path));
  await first.context().close();
  for (let run = 0; run < runs; run += 1) {
    for (const page of PAGES) {
      const cold = await context(browser, gaps);
      out[page.label].cold.push(await press(cold, base + page.path));
      // The same pane again: the browser has the page now.
      out[page.label].repeat.push(await press(cold, base + page.path));
      await cold.context().close();
    }
    process.stderr.write(".");
  }
  process.stderr.write("\n");
  return out;
}

function table(results: Results, press: Press, key: keyof Sample): string {
  const servers = Object.keys(results);
  let md = `| page | ${servers.join(" | ")} | × |\n| --- |${servers.map(() => " ---: |").join("")} ---: |\n`;
  for (const page of PAGES) {
    const [a, b] = servers.map((s) => median(results[s][page.label][press].map((x) => x[key])));
    md += `| ${page.label} | ${Math.round(a)} | ${Math.round(b)} | ${(a / b).toFixed(1)} |\n`;
  }
  return md;
}

/** The median over pages of each page's own speed-up. */
function speedup(results: Results, press: Press, key: keyof Sample): number {
  const [a, b] = Object.keys(results);
  return median(PAGES.map((p) => median(results[a][p.label][press].map((x) => x[key])) / median(results[b][p.label][press].map((x) => x[key]))));
}

/* ─────────────────────────────── the chart ─────────────────────────────── */

export interface Chart {
  title: string;
  stat: string;
  statNote: string;
  /** The reference first, this app second. */
  series: [string, string];
  rows: { label: string; a: number; b: number }[];
  footer: string[];
}

const GEIST = "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2";
const GEIST_MONO = "node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2";
const ICON = "src-tauri/icons/128x128@2x.png";

/**
 * Draws a chart in the landing page's language: Geist, the neutral ramp, the
 * ASCII wave behind, and the brand orange for this app. Values from `src/styles/globals.css`.
 */
export async function drawChart(chart: Chart, file: string) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  await page.setContent(chartHtml(chart));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file });
  await browser.close();
}

/** The chart as a page, 1600 × 900. */
export function chartHtml(chart: Chart): string {
  const b64 = (f: string) => readFileSync(f).toString("base64");
  const c = { ink: "oklch(0.145 0 0)", muted: "oklch(0.556 0 0)", faint: "oklch(0.708 0 0)", rule: "oklch(0 0 0 / 9%)" };
  const top = Math.max(...chart.rows.flatMap((r) => [r.a, r.b]));
  const step = [0.25, 0.5, 1, 2, 5, 10].find((s) => top / s <= 6)!;
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const secs = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + "s";
  const tick = (v: number) => `${+v.toFixed(2)}s`;
  const pct = (v: number) => `${(v / max) * 100}%`;
  const rows = chart.rows
    .map(
      (r) => `<div class="row"><div class="label">${r.label}</div><div class="bars">
        <div class="bar ref" style="width:${pct(r.a)}"><span>${secs(r.a)}</span></div>
        <div class="bar key" style="width:${pct(r.b)}"><span>${secs(r.b)}</span></div></div></div>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${b64(GEIST)}) format("woff2");font-weight:100 900}
@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${b64(GEIST_MONO)}) format("woff2");font-weight:100 900}
:root{--brand:oklch(0.680 0.174 52)}
*{box-sizing:border-box;margin:0}
body{width:1600px;height:900px;background:#fff;color:${c.ink};font:400 19px/1.45 Geist,system-ui,sans-serif;font-feature-settings:"tnum";padding:76px 96px 60px;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased;position:relative;overflow:hidden}
.field{position:absolute;inset:-8px 0 auto;font:400 13px/1.625 "Geist Mono",ui-monospace,monospace;white-space:pre;color:${c.ink};opacity:.09;pointer-events:none;
  -webkit-mask-image:radial-gradient(ellipse 45% 90% at 100% 0%,#000 0%,rgba(0,0,0,.5) 45%,transparent 80%)}
header,.legend,.chart,footer{position:relative}
h1{font-size:64px;font-weight:600;line-height:1.05;letter-spacing:-.04em}
h1 em{font-style:normal;color:var(--brand)}
header p{color:${c.muted};font-size:22px;margin-top:16px;letter-spacing:-.01em}
.legend{display:flex;gap:32px;align-items:center;margin-top:44px;font-size:19px;font-weight:500}
.legend span{display:flex;align-items:center;gap:10px}
.legend i{display:inline-block;width:28px;height:14px;border-radius:4px}
.chart{flex:1;display:flex;flex-direction:column;margin-top:24px}
.grid{position:absolute;left:280px;right:88px;top:0;bottom:36px}
.grid div{position:absolute;top:0;bottom:0;border-left:1px dashed ${c.rule}}
.grid span{position:absolute;bottom:-34px;transform:translateX(-50%);font:400 15px "Geist Mono",monospace;color:${c.faint}}
.rows{flex:1;display:flex;flex-direction:column;justify-content:space-around;padding-bottom:36px}
.row{display:flex;align-items:center}
.label{width:280px;font-size:25px;font-weight:500;letter-spacing:-.015em}
.bars{flex:1;margin-right:88px;display:flex;flex-direction:column;gap:6px}
.bar{height:26px;border-radius:6px;position:relative;min-width:10px}
.bar span{position:absolute;left:100%;top:50%;transform:translateY(-50%);padding-left:14px;font:500 19px "Geist Mono",monospace;white-space:nowrap;letter-spacing:-.02em}
.ref{background:oklch(0.922 0 0)}
.ref span{color:${c.muted}}
.key{background:var(--brand)}
.key span{color:${c.ink};font-weight:600}
footer{margin-top:30px;padding-top:22px;border-top:1px solid ${c.rule};font-size:16px;white-space:nowrap;color:${c.muted};display:flex;align-items:center;gap:10px}
footer span+span:before{content:"·";margin-right:10px;color:${c.faint}}
footer .brand{margin-left:auto;display:flex;align-items:center;gap:10px;font-weight:600;color:${c.ink};letter-spacing:-.01em}
footer .brand:before{content:none}
footer img{width:28px;height:28px}
</style><pre class="field">${buildAsciiField(0.6, 190, 32)}</pre>
<header><h1><em>${chart.stat}</em> ${chart.title}</h1><p>${chart.statNote}</p></header>
<div class="legend"><span><i class="ref"></i>${chart.series[0]}</span><span><i class="key"></i>${chart.series[1]}</span></div>
<div class="chart"><div class="grid">${ticks.map((t) => `<div style="left:${pct(t)}"><span>${tick(t)}</span></div>`).join("")}</div><div class="rows">${rows}</div></div>
<footer>${chart.footer.map((f) => `<span>${f}</span>`).join("")}<span class="brand"><img src="data:image/png;base64,${b64(ICON)}">${chart.series[1]}</span></footer>`;
}

/* ─────────────────────────────── main ─────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const runs = Number(args[args.indexOf("--runs") + 1]) || 5;
  if (!args.includes("--no-build")) {
    const { spawnSync } = await import("node:child_process");
    const build = spawnSync("bun", ["run", "app:build"], { stdio: "inherit", shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const install = detectInstalls().sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  const qt = install && qtWebEngineVersion(install.root);
  // The newest pane this machine has a confirmed engine for; 108 otherwise.
  const chromiumVersion = (qt && CONFIRMED_CHROMIUM[qt]) || CONFIRMED_CHROMIUM["6.5.3"];
  const gaps = gapsFor(Number(chromiumVersion.split(".")[0]));

  const browser = await chromium.launch();
  const results: Results = {};
  const notes: string[] = [];
  try {
    // One server up at a time, so neither measures under the other's load.
    const sidefx = await sidefxServer();
    try {
      notes.push(`SideFX: ${sidefx.what}.`);
      results["SideFX"] = await measure(browser, sidefx.base, runs, gaps);
    } finally {
      sidefx.stop();
    }
    const hmd = await nodebookmdServer();
    try {
      notes.push(`${productName}: ${hmd.what}.`);
      results[productName] = await measure(browser, hmd.base, runs, gaps);
    } finally {
      await hmd.stop();
    }
  } finally {
    await browser.close();
  }

  let md = `# Help server: SideFX against ${productName}\n\n${new Date().toISOString()}\n\n${notes.join("\n")}\n`;
  md += `Pane recreated as Chromium ${chromiumVersion}. Median of ${runs} runs; \`first\` is one sample. Milliseconds.\n\n`;
  for (const pressKind of ["first", "cold", "repeat"] as Press[]) {
    for (const key of ["ttfb", "ready", "complete"] as (keyof Sample)[]) {
      md += `### ${pressKind} press — ${key} (${speedup(results, pressKind, key).toFixed(1)}× median)\n\n${table(results, pressKind, key)}\n`;
    }
  }
  md += `### layout shift (CLS), cold press\n\n${table(results, "cold", "cls").replace(/\| (\d+) \|/g, "| $1 |")}\n`;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify({ notes, chromiumVersion, runs, results }, null, 2)}\n`);
  writeFileSync(`${OUT}/report.md`, md);
  console.log(md);

  if (args.includes("--chart")) {
    const med = (s: string, label: string, p: Press) => median(results[s][label][p].map((x) => x.ready)) / 1000;
    const chart: Chart = {
      title: "than Houdini's help server",
      stat: `${speedup(results, "cold", "ready").toFixed(1)}× faster`,
      statNote: "Median time to a readable page",
      series: ["Houdini help server", productName],
      rows: PAGES.map((p) => ({ label: p.label, a: med("SideFX", p.label, "cold"), b: med(productName, p.label, "cold") })),
      footer: [`Houdini ${install?.version ?? ""}`, `${runs} runs per page`],
    };
    await drawChart(chart, "public/help-server-benchmark.png");
    console.log("Chart: public/help-server-benchmark.png");
  }
}

if (resolve(process.argv[1] ?? "") === resolve("harness/helpbench.mts")) {
  if (!existsSync("harness")) {
    console.error("run this from the repo root");
    process.exit(2);
  }
  await main();
}
