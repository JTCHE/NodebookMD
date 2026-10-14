/**
 * WHAT THE READER WAITS FOR, MEASURED IN A REAL BROWSER.
 *
 *   node harness/ui.mts --port 8801            # against a running --serve
 *   node harness/ui.mts --port 8801 --label "under load"
 *
 * The back-end numbers are `src-tauri/examples/probe/main.rs`. This file
 * answers the ones that only exist once a person is typing at the app: the
 * delay between a key press and the row that answers it, the time a page takes
 * to open and draw, and what happens when navigation is hammered.
 *
 * It drives the BUILT bundle — `dist/`, the same files the installer ships —
 * served by `probe --serve`, which answers `invoke` with the same Rust
 * functions the Tauri commands call. The webview is Chromium here and WebView2
 * in the shipped app; both are Chromium, and the numbers below are React and
 * layout work, not engine trivia. What this cannot see is Tauri's own IPC,
 * which is why `ipc.round_trip` is reported beside them: it is the part of
 * every number here that the real app pays differently.
 *
 * Every measurement is taken INSIDE the page, between two `performance.now()`
 * stamps, so no part of it is the driver talking to the browser.
 */
import { chromium, type Browser, type Page } from "playwright";

/** Marks the page stamps for itself, installed before any of its own code runs. */
const INSTRUMENT = `
window.__marks = { article: null, results: null, field: null, emptied: null, heading: null };

function paint(then) {
  // Two frames: the first callback runs BEFORE the paint it schedules, the
  // second after it. A reader sees the second one.
  requestAnimationFrame(() => requestAnimationFrame(() => then(performance.now())));
}

window.__key = { down: null, echo: null, drawn: null };
window.__act = 0;
window.__wanted = "";
// The heading already on screen when a press starts. A press does not know
// what it is about to open, so the mark fires on the first heading that is not
// this one.
window.__notHeading = null;

addEventListener("keydown", () => {
  window.__key.down = performance.now();
  window.__key.echo = null;
  window.__key.drawn = null;
}, true);

// The letter itself appearing in the field. This one always happens, and it is
// the half of the complaint that says typing feels sluggish.
addEventListener("input", () => paint((at) => (window.__key.echo ??= at)), true);

new MutationObserver(() => {
  if (window.__marks.field === null && document.querySelector("form[role=search] input")) {
    paint((at) => (window.__marks.field ??= at));
  }
  if (window.__marks.results === null && document.querySelector("li[data-row]")) {
    paint((at) => (window.__marks.results ??= at));
  }
  // Any page heading at all, which is what a fresh load has to wait for: the
  // page it draws is the one in the address, and nothing older is on screen.
  if (window.__marks.heading === null && document.querySelector("article.prose h1")) {
    paint((at) => (window.__marks.heading ??= at));
  }
  // The page ASKED FOR, by its own heading. Waiting for any content at all
  // stopped being a measurement the moment the app began holding the previous
  // page on screen while it reads the next one.
  if (window.__marks.article === null && (window.__wanted || window.__notHeading !== null)) {
    var heading = document.querySelector("article.prose h1");
    var text = heading ? heading.textContent.trim() : null;
    var arrived = window.__notHeading !== null
      ? text !== null && text !== window.__notHeading
      : text !== null && text.indexOf(window.__wanted) === 0;
    if (arrived) {
      paint((at) => (window.__marks.article ??= at));
    }
  }
  // The blank frame. Navigation empties the article before the next page
  // arrives, and this is when that hole opened.
  if (window.__marks.emptied === null && !document.querySelector("article.prose")) {
    window.__marks.emptied = performance.now();
  }
  if (window.__key.down !== null && window.__key.drawn === null) {
    paint((at) => (window.__key.drawn ??= at));
  }
}).observe(document, { childList: true, subtree: true, characterData: true });

// The browser's own answer to "how long did that key take", which is the one
// number here that does not depend on how this file watches for a frame.
// "blocked" is the wait before the app handler even ran; "ms" is the whole
// event, handler and the paint it caused.
window.__events = [];
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.name !== "keydown" && entry.name !== "input") continue;
    window.__events.push({ ms: entry.duration, blocked: entry.processingStart - entry.startTime });
  }
}).observe({ type: "event", durationThreshold: 0, buffered: true });
`;

/** What a reader types. The first letters are the expensive ones. */
const QUERY = "copy to points";

/** How many pages the page-open numbers are taken over. The paths themselves
 *  are read from the build at run time and spread across the corpus in path
 *  order: a hand-written list ages into a list of pages that no longer exist,
 *  and it would put SideFX page names in this repository. */
const PAGES = 10;

/** How long to wait for a mark before calling the run broken.
 *
 *  Sixty seconds, not thirty: the reference laptop under load took longer than
 *  thirty to draw its first search field, and a run that dies there reports
 *  nothing at all instead of reporting a bad number. */
const WAIT = 60_000;

/** How long one press may take before it counts as a miss.
 *
 *  A press aims at whatever link the page happens to carry, and some of those
 *  lead to a page the build cannot draw. Waiting `WAIT` for each one is what
 *  turned this run into hours. A press that a reader would call broken is not a
 *  press worth timing, so it is dropped after two seconds. */
const PRESS_WAIT = 2_000;

/** A page to open: its route, and the heading it draws when it is really open. */
interface Doc {
  path: string;
  title: string;
}

export interface UiMetric {
  name: string;
  unit: string;
  value: number;
  worst: number;
  runs: number;
  note: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Milliseconds to microseconds.
 *
 * `performance.now()` returns fractional milliseconds, and the fraction is the
 * only part of most of these numbers that ever moves. Reading them in
 * microseconds is not extra precision invented here — it is the precision the
 * clock already had, stopped being thrown away. `clock.tick_web` says how fine
 * that clock really is, and `frame.tick` says how fine anything DRAWN can ever
 * be: a page cannot appear between two frames, so no drawn number below one
 * frame means anything, however many digits it has.
 */
const us = (samples: number[]) => samples.map((n) => n * 1000);

function measured(name: string, unit: string, samples: number[], note: string): UiMetric {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const value = sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    name,
    unit,
    value: round(value),
    worst: round(sorted.at(-1) ?? 0),
    runs: sorted.length,
    note,
  };
}


/**
 * A REAL POINTER, THE WAY A READER USES ONE.
 *
 * The app navigates on the press, not on the release (see lib/ui/press), and
 * it starts reading the page the pointer is travelling towards (see `warm` in
 * lib/pages). Neither of those shows in a measurement that jumps straight to a
 * route: the route change already has the page in hand.
 *
 * So this moves the mouse onto a real link, waits only as long as a reader
 * waits — a pointer crossing a row, not a pointer parked on it — and presses.
 * It reports both halves, because they fail differently: `down` is the app
 * answering the press at all, and `drawn` is the page arriving.
 */
async function pressThrough(
  page: Page,
  selector: string,
  hoverMs: number,
  known: Set<string>,
): Promise<{ down: number; drawn: number } | null> {
  const target = await page.evaluate(
    ([sel, known]) => {
      const here = location.pathname;
      const pages = new Set(known);
      const link = [...document.querySelectorAll<HTMLAnchorElement>(sel)].find((a) => {
        const href = a.getAttribute("href") ?? "";
        return href.startsWith("/") && href !== here && !href.startsWith("//") && pages.has(href.slice(1));
      });
      if (!link) return null;
      const box = link.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2, href: link.getAttribute("href") };
    },
    [selector, [...known]] as [string, string[]],
  );
  if (!target) return null;

  await page.evaluate(() => {
    window.__marks.article = null;
    window.__wanted = "";
    var heading = document.querySelector("article.prose h1");
    window.__notHeading = heading ? heading.textContent.trim() : "";
  });
  // The pointer arrives. A reader is already moving on, so the pause here is
  // the crossing, not a rest: long enough for the hover to fire, no longer.
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(hoverMs);

  await page.evaluate(() => {
    window.__act = performance.now();
  });
  await page.mouse.down();
  const down = await page.evaluate(
    ([want, limit]) =>
      new Promise<number | null>((done) => {
        const giveUp = performance.now() + (limit as number);
        const seen = () => {
          if (location.pathname === want) return done(performance.now() - window.__act);
          if (performance.now() > giveUp) return done(null);
          requestAnimationFrame(seen);
        };
        seen();
      }),
    [target.href, PRESS_WAIT] as [string, number],
  );
  const drew = await page
    .waitForFunction(() => window.__marks.article !== null, null, { timeout: PRESS_WAIT })
    .then(() => true)
    .catch(() => false);
  await page.mouse.up();
  if (down === null || !drew) return null;
  const drawn = await page.evaluate(() => window.__marks.article - window.__act);
  return { down, drawn };
}

/** Waits for the next page heading, from a stamp the caller set. */
async function drawnSince(page: Page): Promise<number | null> {
  const drew = await page
    .waitForFunction(() => window.__marks.article !== null, null, { timeout: PRESS_WAIT })
    .then(() => true)
    .catch(() => false);
  return drew ? page.evaluate(() => window.__marks.article - window.__act) : null;
}

/** Stamps the start of an action that should draw a page other than this one. */
async function expectOtherPage(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__marks.article = null;
    window.__wanted = "";
    var heading = document.querySelector("article.prose h1");
    window.__notHeading = heading ? heading.textContent.trim() : "";
    window.__act = performance.now();
  });
}

/**
 * TABS, THE DESKTOP WINDOW'S OWN FLOWS.
 *
 * A link opened with Ctrl+Shift comes up in a new tab at once: press to drawn.
 * Ctrl+Shift+Tab goes back to the tab it came from, which already read its
 * page: key to drawn. Ctrl+Tab and Ctrl+W then close the new tab, so every
 * round starts from one tab.
 */
async function tabFlows(page: Page, pages: Doc[], runs: number, known: Set<string>): Promise<{ opened: number[]; switched: number[] }> {
  const opened: number[] = [];
  const switched: number[] = [];
  for (let run = 0; run < runs; run++) {
    for (const path of pages) {
      await openPage(page, path);
      const target = await page.evaluate((known) => {
        const pages = new Set(known);
        const link = [...document.querySelectorAll<HTMLAnchorElement>("article a[href]")].find((a) => {
          const href = a.getAttribute("href") ?? "";
          return href.startsWith("/") && href !== location.pathname && pages.has(href.slice(1).split("#")[0]);
        });
        if (!link) return null;
        const box = link.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, [...known]);
      if (!target) continue;
      await page.mouse.move(target.x, target.y);
      await expectOtherPage(page);
      await page.keyboard.down("Control");
      await page.keyboard.down("Shift");
      await page.mouse.click(target.x, target.y);
      await page.keyboard.up("Shift");
      await page.keyboard.up("Control");
      const open = await drawnSince(page);
      if (open === null) continue;
      opened.push(open);

      await expectOtherPage(page);
      await page.keyboard.press("Control+Shift+Tab");
      const back = await drawnSince(page);
      if (back !== null) switched.push(back);

      await page.keyboard.press("Control+Tab");
      await page.keyboard.press("Control+w");
      await page.waitForTimeout(50);
    }
  }
  return { opened, switched };
}

/** Opens one page by its route and returns how long it took to draw. */
async function openPage(page: Page, target: Doc): Promise<{ drawn: number; blank: number }> {
  const path = target.path;
  await page.evaluate((to) => {
    window.__marks.article = null;
    window.__marks.emptied = null;
    window.__notHeading = null;
    window.__wanted = to.title;
    window.__act = performance.now();
    // Real paths, not a hash: the app runs on `BrowserRouter` so that Houdini
    // can ask for `/nodes/sop/box` flat. A hash change navigates nothing.
    history.pushState({}, "", `/${to.path}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }, target);
  try {
    await page.waitForFunction(() => window.__marks.article !== null, null, { timeout: WAIT });
  } catch (reason) {
    const state = await page.evaluate(() => ({
      at: location.pathname,
      articles: document.querySelectorAll("article").length,
      children: document.querySelectorAll("article.prose > *").length,
      mark: window.__marks.article,
    }));
    throw new Error(`${path} never drew: ${JSON.stringify(state)} (${reason})`);
  }
  return page.evaluate(() => ({
    drawn: window.__marks.article - window.__act,
    // Negative when the article never emptied, which is what a page that keeps
    // the old text on screen until the new one lands looks like.
    blank: window.__marks.emptied === null ? 0 : window.__marks.article - window.__marks.emptied,
  }));
}

/** Page paths taken from the build itself, spread across the corpus in path
 *  order. Taking the first N would measure one section of the docs. */
async function sample(page: Page, base: string, want: number): Promise<Doc[]> {
  await page.goto(base, { waitUntil: "commit" });
  return page.evaluate(async (count) => {
    // A page with no title draws no `h1`, so the draw mark never fires. Those
    // pages are a content defect, not a speed measurement.
    const all: Doc[] = await fetch("/api/titles")
      .then((r) => r.json())
      .then((hits: Doc[]) => hits.filter((hit) => hit.title.trim() !== ""));
    const step = Math.floor(all.length / count) || 1;
    return all
      .filter((_, at) => at % step === 0)
      .slice(0, count)
      .map((hit) => ({ path: hit.path, title: hit.title }));
  }, want);
}

/** Back to the landing page, with the marks cleared for the next measurement. */
async function home(page: Page): Promise<void> {
  await page.evaluate(() => {
    history.pushState({}, "", "/");
    dispatchEvent(new PopStateEvent("popstate"));
    window.__marks.results = null;
    window.__marks.article = null;
  });
  await page.waitForFunction(() => document.querySelector("form[role=search] input") !== null, null, { timeout: WAIT });
}

export async function measureUi(port: number, runs = 3): Promise<UiMetric[]> {
  const browser: Browser = await chromium.launch({ args: ["--js-flags=--expose-gc"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(INSTRUMENT);
    const page = await context.newPage();
    const metrics: UiMetric[] = [];
    const base = `http://127.0.0.1:${port}/`;
    const pages = await sample(page, base, PAGES);

    // 1. OPENING THE APP. Navigation to a search field a reader can type in.
    const start: number[] = [];
    for (let run = 0; run < runs; run++) {
      await page.goto(base, { waitUntil: "commit" });
      await page.waitForFunction(() => window.__marks.field !== null, null, { timeout: WAIT });
      start.push(await page.evaluate(() => window.__marks.field));
    }
    metrics.push(measured("app.first_field", "µs", us(start), "navigation to a field that takes a key"));

    // 2. THE IPC ROUND TRIP. Every number below carries one or more of these.
    //    The shipped app pays Tauri's IPC instead; this is what to subtract
    //    before comparing the two.
    const ipc = await page.evaluate(async () => {
      const taken: number[] = [];
      for (let i = 0; i < 20; i++) {
        const at = performance.now();
        await fetch(`/api/index_status?x=${i}`).then((r) => r.text());
        taken.push(performance.now() - at);
      }
      return taken;
    });
    metrics.push(measured("ipc.round_trip", "µs", us(ipc), "the harness's own stand-in for Tauri IPC"));

    // 3. KEY TO ROW. The reported complaint is that typing feels sluggish, so
    //    this is per KEYSTROKE and not per query: what a reader feels is the
    //    gap between the letter and the list moving under it.
    const echoed: number[] = [];
    const redrawn: number[] = [];
    const first: number[] = [];
    const settling: number[] = [];
    for (let run = 0; run < runs; run++) {
      await home(page);
      await page.click("form[role=search] input");
      await page.fill("form[role=search] input", "");
      for (const letter of QUERY) {
        await page.evaluate(() => {
          window.__key.down = null;
          window.__key.echo = null;
          window.__key.drawn = null;
        });
        await page.keyboard.press(letter === " " ? "Space" : letter);
        await page.waitForFunction(() => window.__key.echo !== null, null, { timeout: WAIT });
        echoed.push(await page.evaluate(() => window.__key.echo - window.__key.down));
        // The list is allowed not to move: two letters into a query that
        // already shows the same eight rows change nothing, and a keystroke
        // that draws nothing is not a keystroke a reader waited for.
        const list = await page
          .waitForFunction(() => window.__key.drawn !== null, null, { timeout: 1000 })
          .then(() => page.evaluate(() => window.__key.drawn - window.__key.down))
          .catch(() => null);
        if (list !== null) {
          redrawn.push(list);
          if (letter === QUERY[0]) first.push(list);
        }
      }
      // 4. SETTLING. The body search runs behind a debounce, so the list keeps
      //    moving after the last key. This is when it stops.
      const settled = await page.evaluate(async () => {
        const at = performance.now();
        let last = performance.now();
        // The list itself, found through the row attribute the app draws it
        // with. Watching the whole document would watch the placeholder
        // animation on the landing page, which never settles.
        const list = document.querySelector("li[data-row]")?.closest("ul");
        const watch = new MutationObserver(() => (last = performance.now()));
        if (list) watch.observe(list, { childList: true, subtree: true, characterData: true });
        while (performance.now() - last < 250) {
          await new Promise((r) => setTimeout(r, 25));
          if (performance.now() - at > 5000) break;
        }
        watch.disconnect();
        return last - at;
      });
      settling.push(settled);
    }
    metrics.push(measured("key.echo", "µs", us(echoed), `the letter itself, over ${QUERY.length} keystrokes`));
    metrics.push(measured("key.redrawn", "µs", us(redrawn), "the keystrokes that moved the list"));
    metrics.push(measured("key.first_letter", "µs", us(first), "the widest match a reader can type"));
    metrics.push(measured("search.settled", "µs", us(settling), "last key to a list that stops moving"));

    // What the browser itself timed, for the same keystrokes. `key.echo` above
    // waits two animation frames to be sure the paint happened, so it reads
    // about one frame high; this does not.
    const events = await page.evaluate(() => window.__events);
    metrics.push(measured("key.blocked", "µs", us(events.map((e) => e.blocked)), "key press to the app's handler"));
    metrics.push(measured("key.event", "µs", us(events.map((e) => e.ms)), "the whole event, handler and paint, rounded to 8ms by the browser"));

    // 5. OPENING A PAGE. Route change to drawn markdown.
    const open: number[] = [];
    const blank: number[] = [];
    for (let run = 0; run < runs; run++) {
      for (const path of pages) {
        await home(page);
        open.push((await openPage(page, path)).drawn);
      }
    }
    metrics.push(measured("page.draw", "µs", us(open), `${pages.length} pages, route change to drawn`));
    // How long the reading area stands empty in the middle of a navigation.
    // Zero means the old page stayed up until the new one was ready.



    // 5b. A REAL PRESS ON A REAL LINK, hovered only as long as a reader
    //     hovers. This is the number the reader actually feels, and it is the
    //     only one that shows whether the hover prefetch is doing its job.
    const known = new Set(await page.evaluate(() => fetch("/api/titles").then((r) => r.json()).then((hits: Doc[]) => hits.filter((h) => h.title.trim() !== "").map((h) => h.path))));
    for (const [name, selector] of [
      ["sidebar", "aside a[href], nav a[href]"],
      ["doclink", "article a[href]"],
    ] as const) {
      for (const hoverMs of [40, 250]) {
        const downs: number[] = [];
        const draws: number[] = [];
        for (let run = 0; run < runs; run++) {
          for (const path of pages) {
            await openPage(page, path);
            const shot = await pressThrough(page, selector, hoverMs, known);
            if (!shot) continue;
            downs.push(shot.down);
            draws.push(shot.drawn);
          }
        }
        if (!draws.length) continue;
        metrics.push(measured(`press.${name}.${hoverMs}ms.route`, "µs", us(downs), "press to the route changing"));
        metrics.push(measured(`press.${name}.${hoverMs}ms.drawn`, "µs", us(draws), `press to drawn, after a ${hoverMs}ms hover`));
      }
    }

    // 5c. TABS. Only the desktop window has them; the probe serves it.
    if (await page.evaluate(() => "__TAURI_INTERNALS__" in window)) {
      const tabs = await tabFlows(page, pages, runs, known);
      metrics.push(measured("tab.open", "µs", us(tabs.opened), "Ctrl+Shift+press on a link to drawn, in a new tab"));
      metrics.push(measured("tab.switch", "µs", us(tabs.switched), "Ctrl+Shift+Tab to the tab before, to drawn"));
    }

    // 6. HAMMERING IT. Straight from page to page with no pause, which is what
    //    a reader with the keyboard does. A number that only holds when the
    //    app is given time to breathe is not a number.
    const hammered: number[] = [];
    for (let round = 0; round < 3; round++) {
      for (const path of pages) {
        const shot = await openPage(page, path);
        hammered.push(shot.drawn);
        blank.push(shot.blank);
      }
    }
    metrics.push(measured("page.hammered", "µs", us(hammered), "back to back, no pause between"));
    // How long the reading area stands empty in the middle of a page-to-page
    // navigation. Zero means the old page stayed up until the new one landed.
    metrics.push(measured("page.blank", "µs", us(blank), "the hole between one page and the next"));

    // 7. RELOAD. The whole bundle again, then the same page.
    const reloaded: number[] = [];
    for (let run = 0; run < runs; run++) {
      await page.reload({ waitUntil: "commit" });
      await page.waitForFunction(() => window.__marks.heading !== null, null, { timeout: WAIT });
      reloaded.push(await page.evaluate(() => window.__marks.heading));
    }
    metrics.push(measured("page.reload", "µs", us(reloaded), "refresh, to drawn markdown"));

    // 8. MEMORY AFTER FIFTY PAGES. The webview half of the answer; the Rust
    //    half is `memory.after_pages` in the probe.
    await home(page);
    for (let i = 0; i < 50; i++) {
      await openPage(page, pages[i % pages.length]);
    }
    const heap = await page.evaluate(() => {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return memory ? memory.usedJSHeapSize / 1024 / 1024 : 0;
    });
    metrics.push(measured("memory.heap_50_pages", "MB", [heap], "JavaScript heap after 50 page opens"));

    // 9. THE TWO FLOORS. Neither is a measurement of the product. They are the
    //    rulers: the first says how fine the clock is, the second says how
    //    fine ANY drawn number can be. A page cannot appear between two
    //    frames, so `page.draw` at 53700µs is three frames, and a change that
    //    saves 2000µs of it saves nothing a reader can see.
    const floors = await page.evaluate(async () => {
      const ticks: number[] = [];
      for (let i = 0; i < 1000; i++) {
        const at = performance.now();
        let gap = 0;
        while (gap === 0) gap = performance.now() - at;
        ticks.push(gap);
      }
      const frames: number[] = [];
      let last = await new Promise<number>((r) => requestAnimationFrame(r));
      for (let i = 0; i < 60; i++) {
        const now = await new Promise<number>((r) => requestAnimationFrame(r));
        frames.push(now - last);
        last = now;
      }
      return { ticks, frames };
    });
    metrics.push(measured("clock.tick_web", "µs", us(floors.ticks), "smallest gap the browser clock can report"));
    metrics.push(measured("frame.tick", "µs", us(floors.frames), "one frame — the floor under everything drawn"));

    return metrics;
  } finally {
    await browser.close();
  }
}

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

if (process.argv[1]?.endsWith("ui.mts")) {
  const port = Number(flag("--port") ?? 8801);
  const runs = Number(flag("--runs") ?? 3);
  measureUi(port, runs).then((metrics) => {
    console.log(JSON.stringify({ label: flag("--label") ?? "quiet", metrics }, null, 2));
  });
}

declare global {
  interface Window {
    __marks: { article: number | null; results: number | null; field: number | null; emptied: number | null; heading: number | null };
    __key: { down: number | null; echo: number | null; drawn: number | null };
    __act: number;
    __wanted: string;
    __notHeading: string | null;
    __events: Array<{ ms: number; blocked: number }>;
  }
}
