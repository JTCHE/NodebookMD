/**
 * HOUDINI'S HELP PANE, RECREATED, SO A BROWSER CAN CHECK IT WITHOUT HOUDINI.
 *
 *   node harness/pane.mts                    # every Houdini install found here
 *   node harness/pane.mts --no-build         # reuse target/release/nodebookmd.exe
 *   node harness/pane.mts --keep             # leave harness/out/pane/ screenshots
 *
 * F1 opens Houdini's own embedded browser (QtWebEngine), not this app's
 * webview and not whatever Chromium runs on this machine. This file finds
 * every Houdini install on the machine, reads which QtWebEngine each one
 * ships, and — for the ones this file has a CONFIRMED Chromium version for —
 * makes this run's own (much newer) Playwright Chromium behave like that one:
 * it deletes the JS APIs that Chromium did not have yet, and it strips the
 * `@supports` blocks a current CSS engine would pass but that one would not.
 * See agents/houdini-pane.md.
 *
 * Two contexts open the SAME real page, off the SAME real server — the exact
 * server `server.rs` starts for F1, not a stub:
 *
 *   pane   the downgrade shim applied — what Houdini's own pane sees
 *   app    no shim — a current engine, same as the desktop window's WebView2
 *
 * A check that only ever runs against `app` cannot catch a regression that
 * only shows in `pane` — which is exactly how the `URLSearchParams.size` bug
 * and the `oklch()`/`color-mix()` bug both slipped past `design.mts`, whose
 * stub answers `invoke()` directly and never touches the HTTP path
 * `src/lib/backend.ts` uses outside Tauri.
 *
 * CONFIRMED CHROMIUM VERSIONS. Qt does not publish a clean table mapping a
 * QtWebEngine version to the Chromium it carries, so this file does not
 * guess one. Each entry in `CONFIRMED_CHROMIUM` was read off a REAL request
 * that Houdini's own pane sent — its `User-Agent` header names the Chromium
 * build outright (`... QtWebEngine/6.5.3 ... Chrome/108.0.5359.220 ...`),
 * logged once in `server.rs`'s request loop with an install hooked to F1. An
 * install whose QtWebEngine version is not in the table is skipped, printed,
 * and left for whoever next has that Houdini open to confirm the same way —
 * see agents/houdini-pane.md for the exact steps.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch, recycle, type Running } from "./app.mts";

const OUT = "harness/out/pane";
const EXE = "src-tauri/target/release/nodebookmd.exe";

/* ─────────────────────────── installs on this machine ────────────────────────── */

interface Install {
  version: string;
  root: string;
}

function ps(script: string): string {
  const res = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
  });
  return (res.stdout ?? "").trim();
}

/** Every build the registry names, the same key `install::registry_roots`
 *  reads in `install.rs` — one value per build, keyed by its own version. */
export function detectInstalls(): Install[] {
  const out = ps(
    `Get-Item 'HKLM:\\SOFTWARE\\Side Effects Software\\Houdini' -ErrorAction SilentlyContinue | ` +
      `ForEach-Object { $_.GetValueNames() } | ForEach-Object { ` +
      `$root = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Side Effects Software\\Houdini').$_; "$_|$root" }`,
  );
  if (!out) return [];
  return out
    .split(/\r?\n/)
    .map((line) => line.split("|"))
    .filter((parts): parts is [string, string] => parts.length === 2 && !!parts[1])
    .map(([version, root]) => ({ version, root: root.replace(/[\\/]+$/, "") }))
    // The key holds more than build entries — `LicenseServer` names a URL,
    // not a path, the same way `install::registry_roots` in `install.rs`
    // finds it too. `read` there drops it once `help.is_dir()` fails; this
    // drops it up front instead, since it has no `bin` to probe either.
    .filter((install) => existsSync(install.root));
}

/** The Qt WebEngine build one install ships, off the DLL's own file version —
 *  a fact read from the machine, not a guess from the Houdini version. */
export function qtWebEngineVersion(root: string): string | null {
  const dll = `${root}\\bin\\Qt6WebEngineCore.dll`;
  const out = ps(
    `if (Test-Path '${dll}') { (Get-Item '${dll}').VersionInfo.FileVersionRaw.ToString() }`,
  );
  if (!out) return null;
  // FileVersionRaw carries a trailing build part Qt always sets to 0.
  return out.replace(/\.0$/, "");
}

/** QtWebEngine version → the Chromium it carries, EACH read off a real
 *  `User-Agent` this app's server logged for that install's own F1 request.
 *  Do not add an entry from a table found online — confirm it the same way. */
export const CONFIRMED_CHROMIUM: Record<string, string> = {
  // Houdini 21.0.729, captured 2026-09-09 — see the closed spec "Local —
  // Houdini's Help Pane Always Said No Page".
  "6.5.3": "108.0.5359.220",
};

function chromiumMajor(version: string): number {
  return Number(version.split(".")[0]);
}

/* ────────────────────────────── known engine gaps ─────────────────────────────── */

interface Gap {
  name: string;
  /** The engine needs at least this Chromium major version to have it. */
  needsChromium: number;
  /** Deletes the JS surface from `window`/its prototypes, run before any
   *  page script. */
  js?: string;
  /** Matches inside an `@supports (...)` condition. Any block whose
   *  condition contains one of these is dropped for this engine, the same
   *  way the engine itself would fail the condition and skip the block. */
  cssSupportsCondition?: RegExp;
}

const GAPS: Gap[] = [
  {
    name: "URLSearchParams.prototype.size",
    needsChromium: 116,
    js: "try { delete URLSearchParams.prototype.size; } catch {}",
  },
  {
    name: "oklch() / oklab() colors",
    needsChromium: 111,
    cssSupportsCondition: /oklab\(|oklch\(/,
  },
  {
    name: "color-mix()",
    needsChromium: 111,
    cssSupportsCondition: /color-mix\(/,
  },
];

export function gapsFor(chromium: number): Gap[] {
  return GAPS.filter((gap) => chromium < gap.needsChromium);
}

/** Strips every `@supports (...) { ... }` block whose condition matches one
 *  of the given gaps, brace-balanced so a nested rule does not truncate it
 *  early. Leaves the plain fallback declaration that always precedes it —
 *  see `postcss.config.js`. */
function stripSupports(css: string, conditions: RegExp[]): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@supports", i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    const open = css.indexOf("{", at);
    if (open === -1) {
      out += css.slice(i);
      break;
    }
    const condition = css.slice(at, open);
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    const drop = conditions.some((re) => re.test(condition));
    out += css.slice(i, at);
    if (!drop) {
      // Tailwind nests its own `@supports` blocks — the `::placeholder`
      // reset wraps `color-mix()` inside an unrelated outer condition, for
      // one real case. A block kept whole would carry that inner one
      // straight through unexamined, so its body is walked the same way
      // before it is appended.
      out += css.slice(at, open + 1) + stripSupports(css.slice(open + 1, j - 1), conditions) + "}";
    }
    i = j;
  }
  return out;
}

function downgradeCss(css: string, gaps: Gap[]): string {
  const conditions = gaps.map((g) => g.cssSupportsCondition).filter((r): r is RegExp => !!r);
  if (conditions.length === 0) return css;

  const out = stripSupports(css, conditions);

  // Not every fallback the plugins write is `@supports`-gated: some come as
  // one property written twice — a plain value, then the modern one right
  // after it — since an engine that cannot parse the second treats the whole
  // declaration as invalid and keeps the first. A REAL old engine already
  // does this on its own; this run's own (current) Chromium does not, so the
  // second declaration is dropped here to match what that engine would keep.
  const inline = new RegExp(`[a-zA-Z-]+\\s*:[^;{}]*?(?:${conditions.map((r) => r.source).join("|")})[^;{}]*;`, "g");
  return out.replace(inline, "");
}

/** Makes a current Chromium page behave like the pane's old one: the missing
 *  JS deleted before any page script, the CSS it cannot parse dropped. */
export async function shimPane(page: Page, gaps: Gap[]): Promise<void> {
  for (const gap of gaps) if (gap.js) await page.addInitScript(gap.js);
  await page.route("**/*.css", async (route) => {
    const response = await route.fetch();
    const body = downgradeCss(await response.text(), gaps);
    // Not `{ response, body }` — that keeps the ORIGINAL response's
    // `content-length`, which is now wrong for a shorter downgraded body, and
    // the browser truncates the stylesheet parse right where the original
    // would have ended. Headers minus that one let Playwright compute the
    // real length itself.
    const headers = { ...response.headers() };
    delete headers["content-length"];
    await route.fulfill({ status: response.status(), headers, contentType: "text/css", body });
  });
}

/* ────────────────────────────── the real server ───────────────────────────────── */

/** Starts the real app — `server::start`, the exact thing F1 hits — pinned to
 *  one install via `HFS` (`install::find` gives a running Houdini's own `HFS`
 *  first pick over everything else, so this does too), as a `--clean` staged
 *  copy so it never touches the reader's real bookmarks or index. */
async function startServer(install: Install): Promise<Running | null> {
  const running = await launch({ clean: true, env: { HFS: install.root } });
  const current = (await fetch(`http://127.0.0.1:${running.port}/api/current_install`)
    .then((r) => r.json())
    .catch(() => null)) as { root?: string } | null;
  if (current?.root?.replace(/[\\/]+$/, "") === install.root) return running;
  console.log(`  the app reads ${JSON.stringify(current?.root ?? current)}, not ${install.root}`);
  await running.stop();
  return null;
}

/* ─────────────────────────────────── scenes ────────────────────────────────────── */

interface Finding {
  install: string;
  scene: string;
  check: string;
  detail: string;
}

interface Scene {
  name: string;
  path: string;
  /** Runs against the `pane` (downgraded) page. Returns findings, if any. */
  check: (page: Page) => Promise<Finding[]>;
}

function bad(scene: string, check: string, detail: string): Finding {
  return { install: "", scene, check, detail };
}

const SCENES: Scene[] = [
  {
    name: "home",
    path: "/",
    check: async (page) => {
      const found: Finding[] = [];
      const pageText = await page.evaluate(() => document.body.innerText);
      if (/no page/i.test(pageText)) found.push(bad("home", "page.loaded", "the home route drew a \"no page\" error"));

      // The ASCII field's low-opacity color comes from a Tailwind `/10`
      // opacity modifier, which Tailwind itself compiles to `color-mix()`.
      const color = await page
        .evaluate(() => {
          const el = document.querySelector("main pre");
          return el ? getComputedStyle(el).color : null;
        })
        .catch(() => null);
      if (!color || color === "rgba(0, 0, 0, 0)")
        found.push(bad("home", "ascii-background.color", `expected a visible color, got ${color ?? "no element"}`));
      return found;
    },
  },
  {
    name: "node-with-callout",
    path: "/nodes/sop/pyrosolver",
    check: async (page) => {
      const found: Finding[] = [];
      const pageText = await page.evaluate(() => document.body.innerText);
      if (/no page/i.test(pageText))
        found.push(bad("node-with-callout", "page.loaded", "the node page drew a \"no page\" error"));

      const callout = await page
        .evaluate(() => {
          const el = document.querySelector("[data-callout]");
          const title = el?.querySelector(".callout-title");
          if (!el || !title) return null;
          const rgb = (text: string) => text.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
          return {
            background: getComputedStyle(el).backgroundColor,
            titleColor: getComputedStyle(title).color,
            titleVisible: title.getBoundingClientRect().width > 0,
          };
        })
        .catch(() => null);
      if (!callout) {
        found.push(bad("node-with-callout", "callout.present", "no [data-callout] .callout-title on the page"));
        return found;
      }
      if (callout.background === "rgba(0, 0, 0, 0)")
        found.push(bad("node-with-callout", "callout.background", "callout background is transparent"));
      // A fallback that degrades a subtle tint to the same solid color as the
      // title text — exactly what a `color-mix()` fallback does when it
      // cannot resolve at build time — draws the title in its own
      // background: readable in theory, invisible on screen. This is the
      // real bug the pixel screenshot showed once and the DOM alone did not:
      // `.callout-title`'s own bounding box was non-empty and its text was
      // there, `getComputedStyle` reported a real color — nothing about the
      // DOM said "broken" until the two colors were compared to each other.
      const toRgb = (text: string) => text.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const [br, bg, bb] = toRgb(callout.background);
      const [tr, tg, tb] = toRgb(callout.titleColor);
      const distance = Math.abs(br - tr) + Math.abs(bg - tg) + Math.abs(bb - tb);
      if (distance < 24)
        found.push(
          bad(
            "node-with-callout",
            "callout.title-contrast",
            `title color ${callout.titleColor} is within ${distance} of its own background ${callout.background}`,
          ),
        );
      return found;
    },
  },
];

/* ──────────────────────────────────── runner ───────────────────────────────────── */

async function runInstall(browser: Browser, install: Install, qtVersion: string): Promise<Finding[]> {
  const chromiumVersion = CONFIRMED_CHROMIUM[qtVersion];
  if (!chromiumVersion) {
    console.log(
      `Houdini ${install.version} — QtWebEngine ${qtVersion} has no confirmed Chromium version, skipped. ` +
        "See agents/houdini-pane.md.",
    );
    return [];
  }
  const chromium_ = chromiumMajor(chromiumVersion);
  const gaps = gapsFor(chromium_);
  console.log(
    `Houdini ${install.version} — QtWebEngine ${qtVersion} — Chromium ${chromiumVersion}` +
      (gaps.length ? `, simulating: ${gaps.map((g) => g.name).join(", ")}` : ", nothing to simulate"),
  );

  const server = await startServer(install);
  if (!server) {
    console.log(`  could not start the server for ${install.root}, skipped`);
    return [];
  }

  const findings: Finding[] = [];
  try {
    for (const scene of SCENES) {
      for (const mode of ["pane", "app"] as const) {
        const downgrade = mode === "pane";
        const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
        const page = await context.newPage();
        if (downgrade) await shimPane(page, gaps);
        await page.goto(`http://127.0.0.1:${server.port}${scene.path}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        if (downgrade) {
          mkdirSync(OUT, { recursive: true });
          await page.screenshot({
            path: `${OUT}/${install.version}-${scene.name}-${mode}.png`,
            fullPage: false,
          });
          const result = await scene.check(page);
          for (const finding of result) findings.push({ ...finding, install: install.version });
        } else {
          mkdirSync(OUT, { recursive: true });
          await page.screenshot({
            path: `${OUT}/${install.version}-${scene.name}-${mode}.png`,
            fullPage: false,
          });
        }
        await context.close();
      }
    }
  } finally {
    await server.stop();
  }
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--no-build")) {
    const build = spawnSync("bun", ["run", "app:build"], { stdio: "inherit", shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  if (!existsSync(EXE)) {
    console.error(`no ${EXE} — run \`bun run app:build\` first, or drop --no-build`);
    process.exit(2);
  }

  const installs = detectInstalls();
  if (installs.length === 0) {
    console.log("no Houdini install found in the registry — nothing to check");
    return;
  }

  if (!args.includes("--keep") && existsSync(OUT)) recycle(resolve(OUT));
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const findings: Finding[] = [];
  try {
    for (const install of installs) {
      const qtVersion = qtWebEngineVersion(install.root);
      if (!qtVersion) {
        console.log(`Houdini ${install.version} — no Qt6WebEngineCore.dll under ${install.root}\\bin, skipped`);
        continue;
      }
      findings.push(...(await runInstall(browser, install, qtVersion)));
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    `${OUT}/report.json`,
    `${JSON.stringify({ at: new Date().toISOString(), findings }, null, 2)}\n`,
  );

  if (findings.length === 0) {
    console.log(`\nAll clean. Shots in ${OUT}/`);
    return;
  }
  console.log(`\n${findings.length} finding(s):\n`);
  for (const finding of findings) {
    console.log(`  Houdini ${finding.install} — ${finding.scene} — ${finding.check}`);
    console.log(`    ${finding.detail}`);
  }
  console.log(`\nShots in ${OUT}/`);
  process.exitCode = 1;
}

// Imported by `helpbench.mts` for the shim; runs only when started itself.
if (resolve(process.argv[1] ?? "") === resolve("harness/pane.mts")) {
  if (!existsSync("harness")) {
    console.error("run this from the repo root");
    process.exit(2);
  }
  await main();
}
