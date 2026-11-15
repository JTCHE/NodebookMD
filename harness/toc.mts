/**
 * THE TABLE OF CONTENTS MARKS THE SECTION THE READER IS IN.
 *
 *   node harness/toc.mts                                  # the pages below
 *   node harness/toc.mts --url http://localhost:8811 nodes/sop/box
 *
 * Runs against `probe --serve` (launch config `probe-serve`), the real bundle
 * on the real install. Three checks, each one a bug that shipped:
 *
 *   - press: every row, in order, in reverse and in a scattered order. The
 *     marked row is the pressed one, or, at the bottom of a page that cannot
 *     scroll that far, a later one.
 *   - wheel: scroll down and up. The marked row is the last heading above
 *     the reading line.
 *   - shift: marking a row makes it bold, and no row changes size.
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const at = args.indexOf("--url");
const BASE = at < 0 ? "http://localhost:8811" : args.splice(at, 2)[1];
const PAGES = args.length
  ? args
  : ["nodes/sop/particlefluidsurface", "nodes/sop/copytopoints", "nodes/dop/flipsolver", "nodes/dop/pyrosolver", "hom/hou/Node"];
const ROWS = "div.absolute nav[aria-label='On this page'] a[href^='#']";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let fails = 0;
const fail = (...what: unknown[]) => {
  fails++;
  console.log("FAIL", ...what);
};

const read = () =>
  page.evaluate((rows) => {
    const box = document.querySelector<HTMLElement>(".docs-shell")!;
    const links = [...document.querySelectorAll(rows)];
    const bar = parseFloat(getComputedStyle(box).getPropertyValue("--page-bar-height")) * 16 || 0;
    const atBottom = box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    const line = atBottom ? box.getBoundingClientRect().bottom : box.getBoundingClientRect().top + bar + 24 + 8;
    let under = -1;
    document.querySelectorAll("article :is(h2,h3,h4,h5,h6)[id]").forEach((heading, index) => {
      if (heading.getBoundingClientRect().top <= line) under = index;
    });
    return {
      active: links.findIndex((link) => link.getAttribute("aria-current") === "location"),
      under,
      atBottom,
      sizes: links.map((link) => `${Math.round(link.getBoundingClientRect().width)}x${Math.round(link.getBoundingClientRect().height)}`).join(),
    };
  }, ROWS);

for (const path of PAGES) {
  await page.goto(`${BASE}/${path}`);
  await page.waitForTimeout(3000);
  const rows = page.locator(ROWS);
  const count = await rows.count();
  const sizes = (await read()).sizes;
  const order = [...Array(count).keys()];
  for (const sequence of [order, [...order].reverse(), order.map((_, i) => (i * 7) % count)]) {
    for (const index of sequence) {
      await rows.nth(index).click();
      await page.waitForTimeout(250);
      const state = await read();
      if (state.active !== index && !(state.atBottom && state.active >= index)) fail(path, "press", index, state.active);
      if (state.sizes !== sizes) fail(path, "shift", index);
    }
  }
  await page.mouse.move(700, 500);
  for (const direction of [1, -1]) {
    for (let step = 0; step < 30; step++) {
      await page.mouse.wheel(0, direction * 700);
      await page.waitForTimeout(200);
      const state = await read();
      if (state.active !== state.under) fail(path, "wheel", state.active, state.under);
    }
  }
  console.log(path, count, "rows");
}
await browser.close();
console.log(fails ? `${fails} failures` : "all good");
process.exit(fails ? 1 : 0);
