/**
 * WHAT THE WINDOW LOOKS LIKE, CHECKED BY MACHINE.
 *
 *   node harness/design.mts                    # build, serve, check, shoot
 *   node harness/design.mts --no-build         # reuse dist/ and the probe
 *   node harness/design.mts --port 8811        # check a server already up
 *   node harness/design.mts --only sidebar     # one area
 *
 * `harness/ui.mts` measures how FAST the app is. This one measures whether it
 * is RIGHT. Every check below is a rule of the design written as a number the
 * browser can answer — a row height, a left edge, a cursor, a mask — because
 * "it looks fine" is what let a title bar ship with a gap down its right side
 * and a sidebar ship with rows of different heights.
 *
 * It also shoots every state it visits into `harness/out/design/`, so the
 * states nobody thinks to open — an empty list, a page with no title, the
 * narrow window, dark mode — are on disk to be looked at rather than imagined.
 *
 * A check states the rule, not the current value. When one fails it prints
 * what it wanted, what it got, and which scene it was in.
 */
import { chromium, type Browser, type Page } from "playwright";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { recycle } from "./app.mts";
import tauri from "../src-tauri/tauri.conf.json" with { type: "json" };
const { productName } = tauri;

const OUT = "harness/out/design";
const WIDE = { width: 1280, height: 820 };
const NARROW = { width: 900, height: 700 };
/** Past 1400px the contents move out of the column and into the right gutter,
    which is the only place they can collide with the header's own controls. */
const HUGE = { width: 1680, height: 900 };

/* ─────────────────────────────── the model ─────────────────────────────── */

interface Finding {
  scene: string;
  check: string;
  want: string;
  got: string;
}

interface Scene {
  name: string;
  /** Everything the scene needs before the checks run. */
  open: (page: Page) => Promise<void>;
  size?: { width: number; height: number };
  theme?: "light" | "dark";
}

type Check = (page: Page) => Promise<Finding[] | Finding | null>;

interface Area {
  id: string;
  scenes: string[];
  check: Check;
  name: string;
}

/* ───────────────────────────── the fixtures ────────────────────────────── */

/** Pages the reader is meant to reach, one per shape of page in the corpus. */
const DOCS = {
  node: "nodes/sop/box",
  vex: "vex/functions/sin",
  hom: "hom/hou/Node",
  learn: "basics/intro",
};

const LIBRARY = [
  { path: "nodes/sop/box", title: "Box", icon: "SOP/box.svg" },
  { path: "nodes/sop/add", title: "Add", icon: "SOP/add.svg" },
  { path: "vex/functions/sin", title: "sin", icon: null },
];

/** Enough rows to make every list scroll. */
function manyEntries(count: number) {
  return Array.from({ length: count }, (_, at) => ({
    path: `nodes/sop/filler${at}`,
    title: `Filler node ${at}`,
    icon: null,
    at: Date.now() - at * 60_000,
  }));
}

async function seed(page: Page, recents: unknown[], bookmarks: unknown[]) {
  await page.evaluate(
    ([r, b]) => {
      localStorage.setItem("nodebookmd.recents", JSON.stringify(r));
      localStorage.setItem("nodebookmd.bookmarks", JSON.stringify(b));
    },
    [recents, bookmarks] as const,
  );
}

async function go(page: Page, hash: string) {
  await page.evaluate((to) => {
    location.hash = to;
  }, hash);
  await page.waitForTimeout(400);
}

/* ────────────────────────────── the scenes ─────────────────────────────── */

const SCENES: Scene[] = [
  {
    name: "landing-empty",
    open: async (page) => {
      await seed(page, [], []);
      await page.reload();
      await go(page, "#/");
    },
  },
  {
    name: "landing-full",
    open: async (page) => {
      await seed(page, LIBRARY.map((e, at) => ({ ...e, at: Date.now() - at * 90_000 })), [LIBRARY[0]]);
      await page.reload();
      await go(page, "#/");
    },
  },
  {
    name: "landing-long",
    open: async (page) => {
      await seed(page, manyEntries(40), manyEntries(9));
      await page.reload();
      await go(page, "#/");
    },
  },
  {
    name: "landing-bookmarks-tab",
    open: async (page) => {
      await seed(page, manyEntries(40), manyEntries(9));
      await page.reload();
      await go(page, "#/?tab=bookmarks");
    },
  },
  {
    name: "docs-node",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
    },
  },
  {
    name: "docs-vex",
    open: async (page) => {
      await go(page, `#/${DOCS.vex}`);
      await page.waitForSelector("article.prose", { timeout: 20_000 });
    },
  },
  {
    name: "sidebar-drilled",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
    },
  },
  {
    name: "sidebar-hidden",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.click('button[aria-label="Hide the sidebar"]');
      await page.waitForTimeout(300);
    },
  },
  {
    name: "recents-open",
    open: async (page) => {
      await seed(page, manyEntries(40), []);
      await page.reload();
      await go(page, "#/");
      await page.click('[aria-label="Show what you read"], nav ~ div button, footer button', { timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(300);
    },
  },
  { name: "docs-dark", theme: "dark", open: async (page) => go(page, `#/${DOCS.node}`) },
  { name: "landing-dark", theme: "dark", open: async (page) => go(page, "#/") },
  { name: "landing-narrow", size: NARROW, open: async (page) => go(page, "#/") },
  { name: "docs-narrow", size: NARROW, open: async (page) => go(page, `#/${DOCS.node}`) },
  { name: "docs-huge", size: HUGE, open: async (page) => go(page, `#/${DOCS.node}`) },
  {
    // A context opened, a family inside it opened, and the window narrow.
    // Three lists deep is where a row that is not the one row shows itself.
    name: "sidebar-family",
    size: NARROW,
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
      await openFamily(page);
    },
  },
  {
    // Every branch of the biggest group asked for, and then another group
    // opened on top of it.
    name: "sidebar-more",
    open: async (page) => {
      await go(page, "#/");
      await page.waitForTimeout(600);
      const more = page.locator('nav[aria-label="Documentation"] button', { hasText: /more/ });
      if (await more.count()) await more.first().click();
      await page.waitForTimeout(200);
      await page.locator('nav[aria-label="Documentation"] button', { hasText: "Reference" }).first().click();
      await page.waitForTimeout(300);
    },
  },
  { name: "landing-huge", size: HUGE, open: async (page) => go(page, "#/") },
  {
    // The panel dragged as narrow as it goes, with the longest names in it.
    // Every name here has to give way to its count rather than run under it.
    name: "sidebar-pinched",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
      const handle = await page.locator('aside [role="separator"]').boundingBox();
      if (handle) {
        await page.mouse.move(handle.x + 2, handle.y + handle.height / 2);
        await page.mouse.down();
        await page.mouse.move(80, handle.y + handle.height / 2, { steps: 8 });
        await page.mouse.up();
      }
      await page.waitForTimeout(300);
    },
  },

  /* ── Theme vs. machine colour scheme ────────────────────────────────────
     `theme.ts` writes `data-theme` from the reader's stored choice; Playwright's
     `colorScheme` stands in for the machine's own setting. The two must be
     free to disagree — that disagreement is exactly what let `dark:` utilities
     fire from the machine while the app painted the theme the reader chose. */
  {
    name: "landing-light-machine-dark",
    theme: "dark",
    open: async (page) => {
      await page.evaluate(() => localStorage.setItem("nodebookmd.theme", "light"));
      await page.reload();
      await go(page, "#/");
    },
  },
  {
    name: "docs-light-machine-dark",
    theme: "dark",
    open: async (page) => {
      await page.evaluate(() => localStorage.setItem("nodebookmd.theme", "light"));
      await page.reload();
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
    },
  },
  {
    name: "landing-dark-machine-light",
    theme: "light",
    open: async (page) => {
      await page.evaluate(() => localStorage.setItem("nodebookmd.theme", "dark"));
      await page.reload();
      await go(page, "#/");
    },
  },
  {
    name: "docs-dark-machine-light",
    theme: "light",
    open: async (page) => {
      await page.evaluate(() => localStorage.setItem("nodebookmd.theme", "dark"));
      await page.reload();
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
    },
  },

  /* ── States nobody thinks to open ────────────────────────────────────── */
  {
    name: "docs-empty-library",
    open: async (page) => {
      await seed(page, [], []);
      await page.reload();
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
    },
  },
  {
    name: "landing-one-entry",
    open: async (page) => {
      await seed(page, [{ ...LIBRARY[0], at: Date.now() }], []);
      await page.reload();
      await go(page, "#/");
    },
  },
  {
    name: "landing-bookmarks-empty",
    open: async (page) => {
      await seed(page, LIBRARY.map((e, at) => ({ ...e, at: Date.now() - at * 90_000 })), []);
      await page.reload();
      await go(page, "#/?tab=bookmarks");
    },
  },
  {
    // A page whose article carries fewer than two headings — the contents
    // controls have to disappear rather than open on a list of nearly nothing.
    name: "docs-few-headings",
    open: async (page) => {
      await go(page, `#/${DOCS.learn}`);
      await page.waitForSelector("article.prose", { timeout: 20_000 });
    },
  },
  {
    // A page long enough to carry forty-plus headings, so the floating pill
    // has somewhere to travel and something to disagree about at the top.
    name: "docs-many-headings",
    open: async (page) => {
      await go(page, `#/${DOCS.hom}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
    },
  },
  {
    name: "docs-many-headings-mid",
    open: async (page) => {
      await go(page, `#/${DOCS.hom}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await page.evaluate(() => {
        const el = document.querySelector(".docs-shell") as HTMLElement | null;
        el?.scrollTo({ top: el.scrollHeight * 0.5 });
      });
      await page.waitForTimeout(400);
    },
  },
  {
    name: "docs-many-headings-bottom",
    open: async (page) => {
      await go(page, `#/${DOCS.hom}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await page.evaluate(() => {
        const el = document.querySelector(".docs-shell") as HTMLElement | null;
        if (el) el.scrollTo({ top: el.scrollHeight });
      });
      await page.waitForTimeout(400);
    },
  },
  {
    // Drilled in, then the window pulled wide and then pinched narrow, with no
    // reload between: a resize the reader actually does mid-session, not one
    // a fresh page load happens to start at.
    name: "sidebar-drilled-resize-huge",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
      await page.setViewportSize(HUGE);
      await page.waitForTimeout(300);
    },
  },
  {
    name: "sidebar-drilled-resize-narrow",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
      await page.setViewportSize(NARROW);
      await page.waitForTimeout(300);
    },
  },
  {
    // Nodes is open by default; asking for Reference must retire it rather
    // than pile a second open group on top of it.
    name: "sidebar-swap-group",
    open: async (page) => {
      await go(page, "#/");
      await page.waitForTimeout(600);
      await page.locator('nav[aria-label="Documentation"] button', { hasText: "Reference" }).first().click();
      await page.waitForTimeout(300);
    },
  },
  {
    // A family opened, and the current page is one of the pages inside it —
    // the "you are here" row and the "this is open" row now coexist.
    name: "sidebar-family-current",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
      await openFamily(page);
      const path = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Documentation"]');
        const link = nav?.querySelector('[data-list] a[href*="#/"]');
        return link?.getAttribute("href") ?? null;
      });
      if (path) {
        await go(page, path);
        await page.waitForTimeout(400);
      }
    },
  },
  {
    // The current page is bookmarked and its branch is drilled into, so the
    // sidebar's own bookmark flag is on screen to check for clipping.
    name: "sidebar-drilled-bookmarked",
    open: async (page) => {
      await seed(page, [], [{ ...LIBRARY[0], at: Date.now() }]);
      await page.reload();
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
    },
  },
  {
    // The list scrolled well past the open group and the open branch, so both
    // headers are drawn over it. This is the scene that says whether a pinned
    // header sits on the axis its own row sat on.
    name: "sidebar-pinned",
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await openContext(page);
      await page.evaluate(() => {
        document.querySelector<HTMLElement>("[data-list]")?.scrollBy({ top: 600 });
      });
      await page.waitForTimeout(400);
    },
  },
  {
    // The window wide enough for the contents list in the gutter, but only
    // just — the panel down the left is what makes "wide enough" a different
    // number from the window's own width.
    name: "docs-toc-edge",
    size: { width: 1462, height: 900 },
    open: async (page) => {
      await go(page, `#/${DOCS.node}`);
      await page.waitForSelector("article.prose h1", { timeout: 20_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    // A short window with Nodes' default branches open — the group header
    // above the list is the row that must not be squeezed by it.
    name: "sidebar-squeezed",
    size: { width: 900, height: 480 },
    open: async (page) => {
      await go(page, "#/");
      await page.waitForTimeout(600);
    },
  },
];

/** Opens the first node context in the panel, whatever it is called. */
async function openContext(page: Page) {
  // A branch row inside the list, and one that is shut — the panel opens on
  // the branch the current page is in, and the pinned copy of that branch is
  // also a button with an em dash in it.
  const row = page.locator('[data-list] button[aria-expanded="false"]', { hasText: "—" }).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(400);
  }
}

/** Opens a family inside the open branch. Families are the rows one step in
    from a branch, so their indent is what names them. */
async function openFamily(page: Page) {
  const row = page.locator(String.raw`[data-list] button.ml-\[42px\]`).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(300);
  }
}

/* ────────────────────────────── the checks ─────────────────────────────── */

const one = (scene: string, check: string, want: string, got: string): Finding => ({ scene, check, want, got });

const AREAS: Area[] = [
  {
    id: "titlebar",
    name: "The caption buttons reach the right edge of the window",
    scenes: ["landing-full", "docs-node", "landing-narrow"],
    check: async (page) => {
      const gap = await page.evaluate(() => {
        const close = document.querySelector('header button[aria-label="Close"]');
        if (!close) return null;
        return Math.round(window.innerWidth - close.getBoundingClientRect().right);
      });
      if (gap === null) return one("", "titlebar.close", "a close button", "none");
      return gap === 0 ? null : one("", "titlebar.close", "0px to the right edge", `${gap}px`);
    },
  },
  {
    id: "titlebar",
    name: "The caption buttons are as tall as the bar",
    scenes: ["landing-full"],
    check: async (page) => {
      const sizes = await page.evaluate(() => {
        const bar = document.querySelector("header")!.getBoundingClientRect().height;
        const buttons = [...document.querySelectorAll('header button[aria-label]')]
          .filter((b) => ["Minimize", "Maximize", "Restore", "Close"].includes(b.getAttribute("aria-label")!))
          .map((b) => b.getBoundingClientRect().height);
        return { bar: Math.round(bar), buttons: buttons.map(Math.round) };
      });
      const wrong = sizes.buttons.filter((h) => h !== sizes.bar);
      return wrong.length === 0
        ? null
        : one("", "titlebar.caption_height", `${sizes.bar}px, the bar's height`, `${wrong.join(", ")}px`);
    },
  },
  {
    id: "titlebar",
    name: "The app name goes home",
    scenes: ["docs-node"],
    check: async (page) => {
      const before = await page.evaluate(() => location.hash);
      const name = page.locator("header a, header button").filter({ hasText: productName }).first();
      if ((await name.count()) === 0) return one("", "titlebar.brand_home", `a ${productName} control`, "none");
      await name.click();
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => location.hash);
      // Put the scene back: every check after this one runs on the same page,
      // and a check that leaves the reader somewhere else makes the next one
      // lie about a page it never saw.
      await page.evaluate((to) => {
        location.hash = to;
      }, before);
      await page.waitForTimeout(500);
      if (after === "#/" || after === "") return null;
      return one("", "titlebar.brand_home", "#/ after the click", `${after} (was ${before})`);
    },
  },
  {
    id: "pointer",
    name: "Everything clickable shows the hand",
    scenes: ["landing-full", "docs-node", "sidebar-drilled"],
    check: async (page) => {
      const wrong = await page.evaluate(() => {
        const clickable = [...document.querySelectorAll("button, a[href], [role=tab], [role=button]")];
        return clickable
          .filter((el) => {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return false;
            if ((el as HTMLButtonElement).disabled) return false;
            return getComputedStyle(el).cursor !== "pointer";
          })
          .slice(0, 6)
          .map((el) => `${el.tagName.toLowerCase()}“${(el.textContent ?? "").trim().slice(0, 24)}”`);
      });
      return wrong.length === 0 ? null : one("", "pointer.cursor", "cursor:pointer", wrong.join(", "));
    },
  },
  {
    id: "sidebar",
    name: "Every row in the panel is the same height",
    scenes: [
      "sidebar-drilled",
      "sidebar-family",
      "sidebar-more",
      "sidebar-drilled-resize-huge",
      "sidebar-drilled-resize-narrow",
      "sidebar-family-current",
    ],
    check: async (page) => {
      const heights = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('nav[aria-label="Documentation"] a')];
        const seen = new Map<number, number>();
        for (const row of rows) {
          const h = Math.round(row.getBoundingClientRect().height);
          seen.set(h, (seen.get(h) ?? 0) + 1);
        }
        return [...seen.entries()];
      });
      return heights.length <= 1
        ? null
        : one("", "sidebar.row_height", "one height for every page row", heights.map(([h, n]) => `${h}px×${n}`).join(", "));
    },
  },
  {
    id: "layout",
    name: "Nothing makes the page scroll sideways",
    scenes: ["docs-toc-edge", "docs-node", "docs-narrow", "docs-huge", "landing-narrow"],
    check: async (page) => {
      const over = await page.evaluate(() => {
        const boxes = [document.documentElement, document.querySelector(".docs-shell")];
        for (const box of boxes) {
          if (!box) continue;
          const past = box.scrollWidth - box.clientWidth;
          if (past > 1) return `${box.className || "the window"} is ${past}px wider than its box`;
        }
        return null;
      });
      return over === null ? null : one("", "layout.no_sideways", "a page that fits its width", over);
    },
  },
  {
    id: "sidebar",
    name: "The panel's rows step in by a known amount, and by nothing else",
    scenes: ["landing-full", "sidebar-more", "sidebar-family"],
    check: async (page) => {
      // A group, a branch, a family and a page are four depths, and each one
      // has one indent. Anything else on screen is a row that missed its step.
      const STEPS = [0, 19, 42, 65];
      const strays = await page.evaluate((steps: number[]) => {
        const list = document.querySelector("[data-list]");
        if (!list) return ["no list"];
        const base =
          list.getBoundingClientRect().left + parseFloat(getComputedStyle(list).paddingLeft);
        const seen = new Set<number>();
        for (const row of list.querySelectorAll("a, button")) {
          const step = Math.round(row.getBoundingClientRect().left - base);
          if (!steps.includes(step)) seen.add(step);
        }
        return [...seen].map(String);
      }, STEPS);
      return strays.length === 0
        ? null
        : one("", "sidebar.left_axis", `rows stepping in by ${STEPS.join(", ")}px`, `also ${strays.join(", ")}px`);
    },
  },
  {
    id: "sidebar",
    name: "A name gives way to its count, it never runs under it",
    scenes: ["sidebar-pinched", "landing-full", "sidebar-more"],
    check: async (page) => {
      const hit = await page.evaluate(() => {
        const panel = document.querySelector("aside")!;
        for (const row of panel.querySelectorAll("a, button")) {
          const count = row.querySelector(".tabular-nums");
          const label = row.querySelector("span.truncate");
          if (!count || !label) continue;
          const c = count.getBoundingClientRect();
          const l = label.getBoundingClientRect();
          if (l.right > c.left + 1) return `${label.textContent} runs under ${count.textContent}`;
        }
        return null;
      });
      return hit === null ? null : one("", "sidebar.count_clear", "a gap between name and count", hit);
    },
  },
  {
    id: "controls",
    name: "A control acts on the press, not on the release",
    scenes: ["sidebar-drilled"],
    check: async (page) => {
      // A row the pointer can actually reach: the list is windowed and it
      // scrolls to the page the reader is on, so the first row in the DOM is
      // usually above the top of the panel.
      const rows = page.locator('nav[aria-label="Documentation"] [data-list] a[href*="#/"]');
      let href: string | null = null;
      let box: { x: number; y: number; width: number; height: number } | null = null;
      const list = await page.locator('nav[aria-label="Documentation"] [data-list]').boundingBox();
      // The pinned headers are drawn over the top of the list, so a row under
      // them belongs to them, not to the reader.
      const pinned = await page.locator("[data-pinned]").boundingBox().catch(() => null);
      const ceiling = pinned ? pinned.y + pinned.height : (list?.y ?? 0);
      for (const row of await rows.all()) {
        const at = await row.boundingBox();
        // Inside the list's own box: a windowed row that has scrolled out of
        // the panel still reports a place, and that place is another
        // control's.
        if (!at || !list || at.y < ceiling || at.y + at.height > list.y + list.height) continue;
        href = await row.getAttribute("href");
        box = at;
        break;
      }
      if (!href || !box) return one("", "controls.press", "a page row on screen", "none");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(250);
      const moved = await page.evaluate(() => location.hash);
      await page.mouse.up();
      await page.waitForTimeout(200);
      return moved === href.replace(/^\.?\//, "")
        ? null
        : one("", "controls.press", `${href} opened by the press alone`, `still at ${moved}`);
    },
  },
  {
    id: "sidebar",
    name: "A list that scrolls says so with a bar",
    scenes: ["sidebar-drilled"],
    check: async (page) => {
      const hit = await page.evaluate(() => {
        const list = document.querySelector("[data-list]") as HTMLElement | null;
        const panel = document.querySelector("aside");
        if (!list || !panel) return "no list";
        if (list.scrollHeight <= list.clientHeight + 1) return "the list does not scroll";
        // The webview draws the bar over the content, so its width says
        // nothing. What says whether the reader sees it is its colour.
        const thumb = getComputedStyle(list).scrollbarColor.split(" ")[0];
        if (/transparent|rgba\(0, 0, 0, 0\)/.test(thumb)) return "the bar is transparent";
        const past = Math.round(
          list.getBoundingClientRect().right - panel.getBoundingClientRect().right,
        );
        return past > 0 ? `the bar hangs ${past}px outside the panel` : null;
      });
      return hit === null ? null : one("", "sidebar.scrollbar", "a bar the reader can see", hit);
    },
  },
  {
    id: "sidebar",
    name: "A pinned header stands where its own row stood",
    scenes: ["sidebar-pinned"],
    check: async (page) => {
      const hit = await page.evaluate(() => {
        const pinned = document.querySelector("[data-pinned]");
        if (!pinned) return "nothing pinned";
        const rows = [...pinned.querySelectorAll("a, button")];
        if (rows.length !== 2) return `${rows.length} pinned rows, not 2`;
        const list = document.querySelector("[data-list]")!;
        // The group is drawn at the top of the list, and it must cover the
        // rows going under it rather than float above them.
        const top = Math.round(rows[0].getBoundingClientRect().top - list.getBoundingClientRect().top);
        if (Math.abs(top) > 1) return `the pinned group sits ${top}px off the top of the list`;
        const label = (el: Element) => el.querySelector("span.truncate")!.getBoundingClientRect().left;
        const drop = Math.round(label(rows[1]) - label(rows[0]));
        return drop === 19 ? null : `the pinned branch is indented ${drop}px, not 19px`;
      });
      return hit === null ? null : one("", "sidebar.pinned", "the two headers held in place", hit);
    },
  },
  {
    id: "sidebar",
    name: "A list that scrolls takes no width from its rows",
    scenes: ["sidebar-family", "sidebar-drilled"],
    check: async (page) => {
      const gap = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Documentation"]')!;
        const list = nav.querySelector("[data-list]") as HTMLElement | null;
        if (!list) return "no list";
        if (list.scrollHeight <= list.clientHeight + 1) return "the list does not scroll";
        const row = list.querySelector("a, button");
        if (!row) return "no rows to compare";
        // The bar's place is held from the start, so the rows sit a bar's
        // width inside the panel — and sit there whether the list scrolls or
        // not, which is the whole point. What must never happen is rows
        // giving up more than the bar takes.
        return Math.round(nav.getBoundingClientRect().right - row.getBoundingClientRect().right);
      });
      if (typeof gap === "string") return one("", "sidebar.no_gutter", "a scrolling list", gap);
      return gap >= 0 && gap <= 16
        ? null
        : one("", "sidebar.no_gutter", "rows inside the panel by a bar's width", `${gap}px short of it`);
    },
  },
  {
    id: "sidebar",
    name: "The groups stay reachable when one of them is open",
    scenes: ["landing-full"],
    check: async (page) => {
      const missing = await page.evaluate(async () => {
        const list = document.querySelector("[data-list]") as HTMLElement | null;
        if (!list) return ["no list"];
        // One list holds the whole tree, so a group under the open one is
        // reached by scrolling. What must never happen is a group that no
        // amount of scrolling brings up.
        list.scrollTop = list.scrollHeight;
        await new Promise((done) => setTimeout(done, 300));
        const box = list.getBoundingClientRect();
        const rows = [...list.querySelectorAll("button")];
        return ["Languages", "Learn", "Reference"].filter((name) => {
          const row = rows.find((one) => (one.textContent ?? "").trim().startsWith(name));
          if (!row) return true;
          const r = row.getBoundingClientRect();
          return r.bottom > box.bottom + 1 || r.top < box.top - 1;
        });
      });
      return missing.length === 0
        ? null
        : one("", "sidebar.groups", "every group reached by scrolling", `${missing.join(" and ")} never comes up`);
    },
  },
  {
    id: "sidebar",
    name: "The open group is marked",
    scenes: ["landing-full"],
    check: async (page) => {
      const marked = await page.evaluate(() => {
        const open = document.querySelector('nav[aria-label="Documentation"] [aria-expanded="true"]');
        if (!open) return null;
        const style = getComputedStyle(open);
        const mark = open.querySelector("svg");
        return {
          colour: style.color,
          mark: mark ? getComputedStyle(mark).color : null,
          weight: style.fontWeight,
          background: style.backgroundColor,
        };
      });
      if (!marked) return one("", "sidebar.open_group", "an open group", "none open");
      const plain =
        marked.background === "rgba(0, 0, 0, 0)" &&
        Number(marked.weight) < 500 &&
        marked.colour === marked.mark;
      return plain ? one("", "sidebar.open_group", "the open group set apart", "same as a shut one") : null;
    },
  },
  {
    id: "sidebar",
    name: "Counts are not typewriter numbers",
    scenes: ["landing-full"],
    check: async (page) => {
      const mono = await page.evaluate(() =>
        [...document.querySelectorAll("aside span")]
          .filter((el) => /^[\d,.]+$/.test((el.textContent ?? "").trim()))
          .filter((el) => /mono/i.test(getComputedStyle(el).fontFamily))
          .map((el) => (el.textContent ?? "").trim())
          .slice(0, 4),
      );
      return mono.length === 0 ? null : one("", "sidebar.count_font", "the page font", `monospace on ${mono.join(", ")}`);
    },
  },
  {
    id: "lists",
    name: "A list that overflows fades; one that fits does not",
    scenes: ["landing-full", "landing-long", "sidebar-drilled", "sidebar-family", "sidebar-more"],
    check: async (page) => {
      const wrong = await page.evaluate(() => {
        const scrolls = (el: Element) => {
          const style = getComputedStyle(el);
          return style.overflowY === "auto" || style.overflowY === "scroll";
        };
        const out: string[] = [];

        // A scroller in the panel or in a tab that is not a list is a list
        // somebody built by hand, and it will be cut across a row.
        for (const el of document.querySelectorAll('aside div, aside nav, [role="tabpanel"] div')) {
          if (!scrolls(el) || el.hasAttribute("data-list")) continue;
          if (el.querySelector("[data-list]")) continue;
          out.push(`a scroller that is not a list: ${(el.textContent ?? "").trim().slice(0, 30)}`);
        }

        return [...document.querySelectorAll("[data-list]")]
          .map((el) => {
            const overflows = el.scrollHeight > el.clientHeight + 1;
            const masked = getComputedStyle(el).maskImage !== "none";
            if (overflows === masked) return null;
            return `${overflows ? "cut off with no fade" : "faded with nothing below"}: ${(el.textContent ?? "").trim().slice(0, 30)}`;
          })
          .concat(out)
          .filter(Boolean)
          .slice(0, 4) as string[];
      });
      return wrong.length === 0 ? null : one("", "lists.fade", "a fade only where there is more below", wrong.join("; "));
    },
  },
  {
    id: "lists",
    name: "Switching tabs does not move the page",
    scenes: ["landing-full"],
    check: async (page) => {
      const tabs = page.locator('[role="tab"]');
      if ((await tabs.count()) < 2) return one("", "lists.tabs", "two tabs", `${await tabs.count()}`);
      const before = await page.evaluate(() => {
        const row = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
        const head = document.querySelector("main h1")!.getBoundingClientRect();
        return { tabs: Math.round(row.top), head: Math.round(head.top), width: Math.round(row.width) };
      });
      await tabs.nth(1).click();
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => {
        const row = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
        const head = document.querySelector("main h1")!.getBoundingClientRect();
        return { tabs: Math.round(row.top), head: Math.round(head.top), width: Math.round(row.width) };
      });
      await tabs.nth(0).click();
      await page.waitForTimeout(200);
      const moved =
        before.tabs !== after.tabs || before.head !== after.head || before.width !== after.width;
      return moved
        ? one("", "lists.tab_shift", "nothing moves", `tabs ${before.tabs}→${after.tabs}, heading ${before.head}→${after.head}`)
        : null;
    },
  },
  {
    id: "lists",
    name: "Every remembered page has a name and a way out",
    scenes: ["landing-full"],
    check: async (page) => {
      const rows = await page.evaluate(() => {
        const list = document.querySelector('[role="tabpanel"], main section');
        if (!list) return null;
        const links = [...list.querySelectorAll("a[href*='#/']")];
        return links.map((link) => {
          const row = link.closest("div")!;
          // The whole row is the link, so the name is on the row or on the
          // link's own label — never inside an overlay that covers the text.
          const title = (link.getAttribute("aria-label") ?? "").trim() || (row.textContent ?? "").trim();
          return {
            title,
            controls: [...row.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? ""),
          };
        });
      });
      if (!rows || rows.length === 0) return one("", "lists.rows", "rows in the list", "none");
      const findings: Finding[] = [];
      const nameless = rows.filter((row) => !row.title);
      if (nameless.length) findings.push(one("", "lists.row_title", "a name on every row", `${nameless.length} without one`));
      const stuck = rows.filter((row) => !row.controls.some((label) => /remove|forget|delete/i.test(label)));
      if (stuck.length) findings.push(one("", "lists.row_remove", "a way to drop a row", `${stuck.length} rows with none`));
      return findings;
    },
  },
  {
    id: "page",
    name: "A doc page names itself",
    scenes: ["docs-node", "docs-vex"],
    check: async (page) => {
      const heading = await page.evaluate(() => {
        const h1 = document.querySelector("article.prose h1, article.prose header");
        return h1 ? (h1.textContent ?? "").trim() : null;
      });
      if (heading === null) return one("", "page.title", "a heading", "none");
      return heading.length > 0 ? null : one("", "page.title", "a name", "empty");
    },
  },
  {
    id: "page",
    name: "A link wears one icon, not two",
    scenes: ["docs-node", "docs-vex"],
    check: async (page) => {
      // A link to a page draws that page's icon. An icon the source writes
      // just in front of the same link draws a second one beside it.
      const doubled = await page.evaluate(() => {
        const icon = (node: Node | null) =>
          node instanceof Element && (node.matches("img, svg, [data-doc-icon]") || !!node.querySelector("[data-doc-icon]"));
        return [...document.querySelectorAll("article a")]
          .filter((link) => {
            let before = link.parentElement?.matches("span.relative") ? link.parentElement.previousSibling : link.previousSibling;
            while (before && before.nodeType === Node.TEXT_NODE && !(before.textContent ?? "").trim()) before = before.previousSibling;
            return icon(before) && icon(link.firstElementChild);
          })
          .map((link) => (link.textContent ?? "").trim());
      });
      return doubled.length === 0 ? null : one("", "page.link_icon", "one icon per link", doubled.slice(0, 4).join(", "));
    },
  },
  {
    id: "page",
    name: "The contents pill opens",
    scenes: ["docs-many-headings"],
    check: async (page) => {
      // The pill only exists once the inline list has scrolled away, which is
      // the state a reader is in when they need it.
      await page.evaluate(() => {
        document.querySelector(".docs-shell")?.scrollTo({ top: 1200 });
      });
      await page.waitForTimeout(600);
      const pill = page.locator('button[aria-label="Table of contents"]').first();
      if ((await pill.count()) === 0) return one("", "page.toc_pill", "a contents control", "none");
      const box = await pill.boundingBox();
      if (!box) return one("", "page.toc_pill", "a control on screen", "not visible");
      const covered = await page.evaluate(({ x, y, w, h }) => {
        const middle = document.elementFromPoint(x + w / 2, y + h / 2);
        const pillNode = middle?.closest("button");
        return pillNode ? null : (middle?.tagName ?? "nothing");
      }, { x: box.x, y: box.y, w: box.width, h: box.height });
      if (covered) return one("", "page.toc_pill", "the pill takes its own clicks", `covered by ${covered}`);
      await pill.click();
      await page.waitForTimeout(300);
      const opened = await page.evaluate(() => {
        const button = document.querySelector('button[aria-label="Table of contents"]');
        return button ? button.getAttribute("aria-expanded") === "true" : null;
      });
      return opened === false ? one("", "page.toc_pill", "a list of headings", "nothing opened") : null;
    },
  },
  {
    id: "page",
    name: "The contents in the gutter clear the page and its controls",
    scenes: ["docs-huge"],
    check: async (page) => {
      const bad = await page.evaluate(() => {
        const gutter = [...document.querySelectorAll('nav[aria-label="On this page"]')].find(
          (nav) => nav.getBoundingClientRect().width > 0,
        );
        if (!gutter) return "no contents in the gutter";
        const box = gutter.getBoundingClientRect();
        if (box.right > window.innerWidth) return "the contents run off the window";
        const over = (a: DOMRect, b: DOMRect) =>
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        // The contents carry their own heading; only the PAGE's text counts.
        const outside = gutter.parentElement!;
        const clash = [...document.querySelectorAll("article.prose header button, article.prose p, article.prose h1")]
          .filter((el) => !outside.contains(el))
          .find((el) => over(el.getBoundingClientRect(), box));
        if (!clash) return null;
        return `the contents sit on ${clash.getAttribute("aria-label") ?? clash.tagName.toLowerCase()}`;
      });
      return bad === null ? null : one("", "page.toc_gutter", "contents beside the page, touching nothing", bad);
    },
  },
  {
    id: "page",
    name: "The header's controls do not sit on the page's own text",
    scenes: ["docs-node", "docs-narrow"],
    check: async (page) => {
      const hit = await page.evaluate(() => {
        const header = document.querySelector("article.prose header");
        if (!header) return "no header";
        const controls = [...header.querySelectorAll("button")];
        const title = header.querySelector("h1");
        if (!title || controls.length === 0) return "no controls";
        const over = (a: DOMRect, b: DOMRect) =>
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const name = title.getBoundingClientRect();
        const clash = controls.find((control) => over(control.getBoundingClientRect(), name));
        return clash ? (clash.getAttribute("aria-label") ?? "a control") : null;
      });
      return hit === null
        ? null
        : one("", "page.header_overlap", "the controls beside the name", `${hit} over it`);
    },
  },
  {
    id: "controls",
    name: "No control on screen does nothing",
    scenes: ["landing-full", "docs-node"],
    check: async (page) => {
      // A button that is drawn, enabled, and inert is the worst of the three
      // states: it says "press me" and then lies. Either it acts, or it says
      // it cannot by being disabled.
      const dead = await page.evaluate(() => {
        const react = (el: Element) =>
          Object.keys(el).some((key) => key.startsWith("__reactProps"));
        return [...document.querySelectorAll("button")]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) return false;
            if ((el as HTMLButtonElement).disabled) return false;
            if (!react(el)) return false;
            const props = Object.entries(el).find(([key]) => key.startsWith("__reactProps"))![1] as {
              onClick?: unknown;
            };
            return typeof props.onClick !== "function";
          })
          .map((el) => el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 24));
      });
      return dead.length === 0 ? null : one("", "controls.dead", "an action or a disabled state", `${dead.join(", ")}`);
    },
  },
  {
    id: "controls",
    name: "The theme switch switches the theme",
    scenes: ["landing-full"],
    check: async (page) => {
      const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const button = page.locator('aside button[aria-label*="theme" i]').first();
      if ((await button.count()) === 0) return one("", "controls.theme", "a theme switch", "none");
      await button.click();
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await button.click();
      await page.waitForTimeout(200);
      return before === after
        ? one("", "controls.theme", "another background", `${after} both times`)
        : null;
    },
  },
  {
    id: "controls",
    name: "The keep shortcut keeps the page",
    scenes: ["docs-node"],
    check: async (page) => {
      const kept = () =>
        page.evaluate(() => JSON.parse(localStorage.getItem("nodebookmd.bookmarks") ?? "[]").length as number);
      const before = await kept();
      await page.keyboard.press("Control+d");
      await page.waitForTimeout(300);
      const after = await kept();
      if (after === before) return one("", "controls.keep", "one more kept page", `${after}, unchanged`);
      await page.keyboard.press("Control+d");
      await page.waitForTimeout(300);
      const back = await kept();
      return back === before
        ? null
        : one("", "controls.keep", "the same shortcut lets it go", `${back} left`);
    },
  },
  {
    id: "lists",
    name: "An empty library says what fills it",
    scenes: ["landing-empty"],
    check: async (page) => {
      const said = await page.evaluate(() =>
        [...document.querySelectorAll("aside p, main p")]
          .map((el) => (el.textContent ?? "").trim())
          .some((text) => /keep it|nothing read|show up/i.test(text)),
      );
      return said ? null : one("", "lists.empty", "a word about what goes here", "an empty box");
    },
  },
  {
    id: "layout",
    name: "Nothing sticks out sideways",
    scenes: [
      "landing-full",
      "docs-node",
      "landing-narrow",
      "docs-narrow",
      "sidebar-drilled",
      "sidebar-drilled-resize-huge",
      "sidebar-drilled-resize-narrow",
    ],
    check: async (page) => {
      const over = await page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      });
      return over <= 0 ? null : one("", "layout.overflow", "no sideways scroll", `${over}px past the window`);
    },
  },
  {
    id: "layout",
    name: "The bars keep their places",
    scenes: ["landing-full", "docs-node", "docs-narrow"],
    check: async (page) => {
      const places = await page.evaluate(() => {
        const header = document.querySelector("header")!.getBoundingClientRect();
        const keys = [...document.querySelectorAll("footer, div")]
          .filter((el) => /Search/.test(el.textContent ?? "") && el.className.includes("h-statusbar"))
          .map((el) => el.getBoundingClientRect())[0];
        return {
          top: Math.round(header.top),
          bottom: keys ? Math.round(window.innerHeight - keys.bottom) : null,
        };
      });
      const bad: string[] = [];
      if (places.top !== 0) bad.push(`bar starts at ${places.top}px`);
      if (places.bottom !== null && places.bottom !== 0) bad.push(`keys end ${places.bottom}px above the floor`);
      return bad.length === 0 ? null : one("", "layout.bars", "bar at the top, keys at the floor", bad.join(", "));
    },
  },
  {
    id: "theme",
    name: "A raised chip is lighter than what it sits on, in both themes",
    scenes: ["docs-node", "docs-dark"],
    check: async (page) => {
      const read = await page.evaluate(() => {
        const luma = (colour: string) => {
          const [r, g, b] = (colour.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number);
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const panel = document.querySelector("aside");
        const chip = document.querySelector('aside a[aria-current="page"]');
        if (!panel || !chip) return null;
        return {
          panel: luma(getComputedStyle(panel).backgroundColor),
          chip: luma(getComputedStyle(chip).backgroundColor),
        };
      });
      if (!read) return one("", "theme.raised", "a chip on the panel", "none found");
      return read.chip > read.panel
        ? null
        : one("", "theme.raised", "a chip lighter than the panel", `chip ${Math.round(read.chip)} on panel ${Math.round(read.panel)}`);
    },
  },
  {
    id: "controls",
    name: "Every icon the panel asks for arrives",
    scenes: ["landing-full", "sidebar-drilled"],
    check: async (page) => {
      await page.waitForTimeout(1200);
      const broken = await page.evaluate(() =>
        [...document.querySelectorAll("aside [data-doc-icon]")]
          .filter((el) => (el as HTMLElement).dataset.imageState === "broken")
          .map((el) => el.querySelector("img")?.getAttribute("src") ?? "?"),
      );
      return broken.length === 0 ? null : one("", "controls.icons", "every icon drawn", broken.slice(0, 4).join(", "));
    },
  },
  {
    id: "controls",
    name: "The panel opens and shuts on the keyboard",
    scenes: ["landing-full"],
    check: async (page) => {
      const panels = () => page.locator("aside").count();
      if ((await panels()) !== 1) return one("", "controls.sidebar_key", "a panel to shut", "none");
      await page.keyboard.press("Control+b");
      await page.waitForTimeout(300);
      if ((await panels()) !== 0) return one("", "controls.sidebar_key", "the panel shut", "still there");
      await page.keyboard.press("Control+b");
      await page.waitForTimeout(300);
      return (await panels()) === 1 ? null : one("", "controls.sidebar_key", "the panel back", "still shut");
    },
  },
  {
    id: "controls",
    name: "The panel takes the width it is dragged to",
    scenes: ["landing-full"],
    check: async (page) => {
      const width = () => page.evaluate(() => document.querySelector("aside")!.getBoundingClientRect().width);
      const before = await width();
      const handle = page.locator('aside [role="separator"]');
      if ((await handle.count()) === 0) return one("", "controls.resize", "a handle on the edge", "none");
      const box = (await handle.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const after = await width();
      return Math.abs(after - before) > 20
        ? null
        : one("", "controls.resize", "a wider panel after the drag", `${Math.round(before)} to ${Math.round(after)}px`);
    },
  },
  {
    id: "lists",
    name: "A row in the library takes a click anywhere on it",
    scenes: ["landing-full"],
    check: async (page) => {
      const row = page.locator('main a[href*="#/"]').first();
      if ((await row.count()) === 0) return one("", "lists.row_hit", "a row to click", "none");
      const box = (await row.boundingBox())!;
      // The far right of the row, past the name — the part a reader hits when
      // they aim at the row rather than at the word.
      await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2);
      await page.waitForTimeout(500);
      const where = await page.evaluate(() => location.hash);
      const landed = where !== "#/" && where !== "";
      if (!landed) return one("", "lists.row_hit", "the page the row names", `still on ${where || "#/"}`);
      await page.evaluate(() => {
        location.hash = "#/";
      });
      await page.waitForTimeout(300);
      return null;
    },
  },
  {
    id: "console",
    name: "The page reports no errors",
    scenes: [
      "landing-full",
      "docs-node",
      "sidebar-drilled",
      "sidebar-family",
      "sidebar-more",
      "landing-huge",
      "docs-huge",
      "landing-long",
      "landing-dark",
      "docs-dark",
      "recents-open",
      "landing-bookmarks-tab",
      "sidebar-hidden",
      "landing-light-machine-dark",
      "docs-light-machine-dark",
      "landing-dark-machine-light",
      "docs-dark-machine-light",
      "docs-empty-library",
      "landing-one-entry",
      "landing-bookmarks-empty",
      "docs-few-headings",
      "docs-many-headings",
      "docs-many-headings-mid",
      "docs-many-headings-bottom",
      "sidebar-drilled-resize-huge",
      "sidebar-drilled-resize-narrow",
      "sidebar-swap-group",
      "sidebar-family-current",
      "sidebar-drilled-bookmarked",
      "sidebar-squeezed",
    ],
    check: async (page) => {
      const all = (page as Page & { __errors?: string[] }).__errors ?? [];
      // A page whose icon the install does not ship asks for a file that is
      // not there and the webview logs it. The app already draws nothing in
      // that case, so the miss is the help's, not the app's.
      const missing = all.filter((line) => /^404 \/icon\/.*\.svg$/.test(line));
      const errors = all.filter(
        (line) =>
          !missing.includes(line) &&
          // The webview logs the miss twice: once as the response, once as
          // this line, which names nothing.
          !(missing.length > 0 && line.startsWith("Failed to load resource")),
      );
      return errors.length === 0 ? null : one("", "console.errors", "no errors", errors.slice(0, 3).join(" | "));
    },
  },

  /* ── Theme vs. machine colour scheme ────────────────────────────────────
     `dark:` used to read the MACHINE's `prefers-color-scheme` rather than the
     app's own `data-theme`, so a reader's chosen theme and their OS setting
     could disagree and still both paint. The first check below states the
     whole class of the bug — nothing on screen may depend on the machine's
     scheme once the app's own theme is fixed. The second nails down the exact
     symptom the reader found by hand: the search field's border. */
  {
    id: "theme",
    name: "Nothing on screen depends on the machine's colour scheme, only on the app's own theme",
    scenes: ["landing-full", "docs-node"],
    check: async (page) => {
      const read = () =>
        page.evaluate(() => {
          const article = document.querySelector("article.prose");
          const form = document.querySelector('form[role="search"]');
          const code = document.querySelector(".code-panel");
          return {
            page: getComputedStyle(document.body).backgroundColor,
            text: article ? getComputedStyle(article).color : null,
            searchBorder: form ? getComputedStyle(form).borderColor : null,
            code: code ? getComputedStyle(code).backgroundColor : null,
          };
        });
      /* Pin the theme the scene happens to be wearing. Without a stored
         choice the app follows the machine on purpose, and flipping the
         machine's scheme would repaint for the right reason. */
      await page.evaluate(() => {
        const theme = document.documentElement.dataset.theme ?? "light";
        window.localStorage.setItem("nodebookmd.theme", theme);
      });
      const before = await read();
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForTimeout(200);
      const underDark = await read();
      await page.emulateMedia({ colorScheme: "light" });
      await page.waitForTimeout(200);
      const keys = Object.keys(before) as Array<keyof typeof before>;
      const changed = keys.filter((key) => before[key] !== null && before[key] !== underDark[key]);
      return changed.length === 0
        ? null
        : one(
            "",
            "theme.machine_independent",
            "the same value under both colour schemes",
            `${changed.join(", ")} changed when only the machine's scheme flipped`,
          );
    },
  },
  {
    id: "theme",
    name: "The app's own theme wins over the machine's colour scheme",
    scenes: ["landing-light-machine-dark", "landing-dark-machine-light"],
    check: async (page) => {
      const result = await page.evaluate(() => {
        const toRGB = (value: string) => {
          const probe = document.createElement("div");
          probe.style.color = value;
          document.body.appendChild(probe);
          const rgb = getComputedStyle(probe).color;
          probe.remove();
          return rgb;
        };
        const form = document.querySelector('form[role="search"]');
        if (!form) return null;
        const theme = document.documentElement.dataset.theme;
        const want = toRGB(theme === "dark" ? "black" : "var(--hairline)");
        const got = getComputedStyle(form).borderColor;
        return { theme, want, got };
      });
      if (!result) return one("", "theme.wins_over_machine", "a search field to check", "none");
      return result.want === result.got
        ? null
        : one(
            "",
            "theme.wins_over_machine",
            `the ${result.theme} app theme's own border colour (${result.want})`,
            `${result.got}, borrowed from the machine`,
          );
    },
  },
  {
    id: "titlebar",
    name: "The brand control's hover box matches the trail arrows' hover box",
    scenes: ["docs-node"],
    check: async (page) => {
      const boxes = await page.evaluate(() => {
        const read = (el: Element | null) => {
          if (!el) return null;
          const style = getComputedStyle(el);
          return { height: Math.round(el.getBoundingClientRect().height), radius: style.borderRadius };
        };
        return {
          brand: read(document.querySelector('header a[href="#/"], header a[href="/"]')),
          back: read(document.querySelector('header button[aria-label="Back"]')),
          forward: read(document.querySelector('header button[aria-label="Forward"]')),
        };
      });
      if (!boxes.brand || !boxes.back || !boxes.forward)
        return one("", "titlebar.hover_geometry", "the brand control and both trail arrows", "one of them missing");
      const bad = [boxes.back, boxes.forward].filter(
        (b) => b.height !== boxes.brand!.height || b.radius !== boxes.brand!.radius,
      );
      return bad.length === 0
        ? null
        : one(
            "",
            "titlebar.hover_geometry",
            `height ${boxes.brand.height}px and radius ${boxes.brand.radius}, same as the brand control`,
            bad.map((b) => `${b.height}px / ${b.radius}`).join(", "),
          );
    },
  },
  {
    id: "layout",
    // A mark that hangs outside its own row is only safe there because
    // nothing between it and the window clips it. `overflow-y: auto` with no
    // `overflow-x` set computes the X axis to `auto` too, not `visible` — the
    // exact trap the library row's `-ml-[21px] pl-[13px]` fix works around.
    name: "A mark meant to hang outside its row is not cut by a clipping ancestor",
    scenes: ["landing-full", "sidebar-drilled-bookmarked"],
    check: async (page) => {
      const escaped = await page.evaluate(() => {
        const targets: Array<{ label: string; el: Element | null }> = [
          { label: "the bookmark flag on a library row", el: document.querySelector('main [class*="-left-[13px]"]') },
          {
            label: "the bookmark flag on a sidebar row",
            el: document.querySelector('nav[aria-label="Documentation"] [class*="-left-[9px]"]'),
          },
          { label: "a keycap's bottom shadow", el: document.querySelector('footer [class*="shadow-keycap"]') },
        ];

        function painted(el: Element) {
          const rect = el.getBoundingClientRect();
          let { top, right, bottom, left } = rect;
          const shadow = getComputedStyle(el).boxShadow;
          if (shadow && shadow !== "none") {
            for (const layer of shadow.split(/,(?![^(]*\))/)) {
              if (/inset/.test(layer)) continue;
              const nums = (layer.match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);
              const [x = 0, y = 0, blur = 0, spread = 0] = nums;
              top = Math.min(top, rect.top + y - blur - spread);
              bottom = Math.max(bottom, rect.bottom + y + blur + spread);
              left = Math.min(left, rect.left + x - blur - spread);
              right = Math.max(right, rect.right + x + blur + spread);
            }
          }
          return { top, right, bottom, left };
        }

        function clippingAncestor(el: Element): Element | null {
          let node = el.parentElement;
          while (node) {
            const s = getComputedStyle(node);
            if (/(auto|hidden|scroll|clip)/.test(s.overflow + s.overflowX + s.overflowY)) return node;
            node = node.parentElement;
          }
          return null;
        }

        const found: string[] = [];
        for (const { label, el } of targets) {
          if (!el) continue;
          const clip = clippingAncestor(el);
          if (!clip) continue;
          const box = painted(el);
          const c = clip.getBoundingClientRect();
          if (box.top < c.top - 0.5 || box.bottom > c.bottom + 0.5 || box.left < c.left - 0.5 || box.right > c.right + 0.5) {
            found.push(label);
          }
        }
        return found;
      });
      return escaped.length === 0
        ? null
        : one("", "layout.overhang_clipped", "the mark's painted box inside its clipping ancestor", escaped.join(", "));
    },
  },
  {
    id: "sidebar",
    name: "Exactly one row wears the raised chip at a time",
    scenes: ["sidebar-drilled", "sidebar-family", "sidebar-family-current", "sidebar-swap-group", "sidebar-more"],
    check: async (page) => {
      /* A top-level group header wears the chip while its branch is open, by
         design, and it sits outside the list. Inside the list the chip means
         one thing only: the page you are on. An open family is NOT that, and
         used to draw the chip anyway. */
      const raised = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Documentation"]');
        if (!nav) return [];
        return [...nav.querySelectorAll("[data-list] a, [data-list] button")]
          .filter((el) => {
            const box = el.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(el).boxShadow !== "none";
          })
          .map((el) => ({
            label: (el.textContent ?? "").trim().slice(0, 24),
            current: el.getAttribute("aria-current") === "page",
          }));
      });
      const wrong = raised.filter((row) => !row.current);
      if (wrong.length > 0)
        return one("", "sidebar.one_chip", "only the page you are on raised", wrong.map((r) => r.label).join(", "));
      return raised.length <= 1
        ? null
        : one("", "sidebar.one_chip", "exactly one row raised", `${raised.length}: ${raised.map((r) => r.label).join(", ")}`);
    },
  },
  {
    id: "sidebar",
    name: "Opening a group retires the one open before it",
    scenes: ["sidebar-swap-group"],
    check: async (page) => {
      const open = await page.evaluate(() =>
        [...document.querySelectorAll('nav[aria-label="Documentation"] [aria-expanded="true"]')].map((el) =>
          (el.textContent ?? "").trim(),
        ),
      );
      return open.length === 1
        ? null
        : one("", "sidebar.accordion_swap", "exactly one group open after asking for another", `${open.length} open: ${open.join(", ")}`);
    },
  },
  {
    id: "sidebar",
    name: "In the drilled view, page labels share one x and a nested page's icon sits on its family's label x",
    scenes: ["sidebar-family"],
    check: async (page) => {
      const result = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Documentation"]');
        const list = nav?.querySelector("[data-list]");
        if (!list) return "no drilled list";
        const rows = [...list.querySelectorAll("a, button")];
        if (rows.length === 0) return "no rows";
        let familyLabelX: number | null = null;
        const pageLabelXs: number[] = [];
        const pageIconXs: number[] = [];
        for (const row of rows) {
          const label = row.querySelector("span.truncate");
          if (!label) continue;
          if (row.hasAttribute("aria-expanded")) {
            if (familyLabelX === null) familyLabelX = Math.round(label.getBoundingClientRect().left);
          } else {
            pageLabelXs.push(Math.round(label.getBoundingClientRect().left));
            const icon = row.querySelector("img, svg");
            if (icon) pageIconXs.push(Math.round(icon.getBoundingClientRect().left));
          }
        }
        return { familyLabelX, pageLabelXs, pageIconXs };
      });
      if (typeof result === "string")
        return one("", "sidebar.family_axis", "a drilled panel with an open family", result);
      const bad: string[] = [];
      const distinctPageLabels = new Set(result.pageLabelXs);
      if (distinctPageLabels.size > 1)
        bad.push(`page labels on ${distinctPageLabels.size} different x: ${[...distinctPageLabels].join(", ")}`);
      if (result.familyLabelX !== null && result.pageIconXs.some((x) => x !== result.familyLabelX)) {
        bad.push(`a page icon off the family's label x (${result.familyLabelX}): ${result.pageIconXs.join(", ")}`);
      }
      return bad.length === 0
        ? null
        : one("", "sidebar.family_axis", "page labels on one x, page icons on the family's label x", bad.join("; "));
    },
  },
  {
    id: "sidebar",
    name: "A group header holds --spacing-row even when the list under it is squeezed",
    scenes: ["sidebar-squeezed"],
    check: async (page) => {
      const result = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Documentation"]');
        if (!nav) return null;
        const want = Math.round(
          Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spacing-row")),
        );
        const headers = [...nav.children]
          .map((group) => group.querySelector(":scope > button"))
          .filter((el): el is Element => !!el);
        const heights = headers.map((el) => Math.round(el.getBoundingClientRect().height));
        return { want, heights };
      });
      if (!result) return one("", "sidebar.header_height", "group headers", "none");
      const wrong = result.heights.filter((h) => h !== result.want);
      return wrong.length === 0
        ? null
        : one("", "sidebar.header_height", `${result.want}px, every group header`, wrong.join(", ") + "px");
    },
  },
  {
    id: "lists",
    name: "A library row holds its height whichever tab is open",
    scenes: ["landing-full"],
    check: async (page) => {
      const heightOf = () =>
        page.evaluate(() => {
          const link = document.querySelector('main a[href*="#/"]');
          const row = link?.closest("div");
          return row ? Math.round(row.getBoundingClientRect().height) : null;
        });
      const recents = await heightOf();
      const bookmarksTab = page.locator('[role="tab"]', { hasText: "Bookmarks" }).first();
      if ((await bookmarksTab.count()) === 0) return one("", "lists.row_height_tabs", "a Bookmarks tab", "none");
      await bookmarksTab.click();
      await page.waitForTimeout(300);
      const bookmarks = await heightOf();
      await page.locator('[role="tab"]', { hasText: "Recents" }).first().click();
      await page.waitForTimeout(200);
      if (recents === null || bookmarks === null)
        return one("", "lists.row_height_tabs", "a row in each tab", "missing a row in one of them");
      return recents === bookmarks
        ? null
        : one("", "lists.row_height_tabs", "the same row height in both tabs", `${recents}px in Recents, ${bookmarks}px in Bookmarks`);
    },
  },
  {
    id: "lists",
    name: "A cold library still offers somewhere to go, not only a sentence",
    scenes: ["landing-empty"],
    check: async (page) => {
      const hrefs = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return null;
        return [...main.querySelectorAll("a[href]")]
          .filter((a) => !a.closest("form"))
          .map((a) => a.getAttribute("href") ?? "");
      });
      if (hrefs === null) return one("", "lists.cold_start", "a main column", "none");
      const named = hrefs.filter((href) => href.replace(/^#\/?/, "").length > 0);
      return named.length === 0
        ? one("", "lists.cold_start", "links to somewhere, beyond the search field", "none")
        : null;
    },
  },
  {
    id: "page",
    name: "The contents controls exist exactly when the page has two headings or more",
    scenes: ["docs-node", "docs-vex", "docs-many-headings", "docs-few-headings"],
    check: async (page) => {
      const state = await page.evaluate(() => ({
        count: document.querySelectorAll("article.prose :is(h2, h3, h4, h5, h6)[id]").length,
        hasToc: !!document.querySelector('nav[aria-label="On this page"]'),
      }));
      const shouldHave = state.count >= 2;
      return shouldHave === state.hasToc
        ? null
        : one(
            "",
            "page.toc_presence",
            shouldHave ? "contents controls, given 2+ headings" : "no contents controls, given fewer than 2 headings",
            `${state.count} headings, controls ${state.hasToc ? "present" : "absent"}`,
          );
    },
  },
  {
    id: "page",
    name: "The contents pill is invisible and inert at the top of the page",
    scenes: ["docs-many-headings"],
    check: async (page) => {
      await page.evaluate(() => document.querySelector(".docs-shell")?.scrollTo({ top: 0 }));
      await page.waitForTimeout(500);
      const state = await page.evaluate(() => {
        const pill = [...document.querySelectorAll("button")].find((b) => /on this page/i.test(b.textContent ?? ""));
        const wrapper = pill?.closest(".sticky") as HTMLElement | null;
        if (!wrapper) return null;
        const style = getComputedStyle(wrapper);
        return { opacity: Number(style.opacity), pointerEvents: style.pointerEvents };
      });
      if (!state) return one("", "page.toc_pill_top", "a contents pill", "none found");
      return state.opacity === 0 && state.pointerEvents === "none"
        ? null
        : one("", "page.toc_pill_top", "invisible and inert at the top", `opacity ${state.opacity}, pointer-events ${state.pointerEvents}`);
    },
  },
  {
    id: "page",
    // The scroller is `.docs-shell`, not the window — the window never
    // scrolls under this app's shell, so a check against it would pass on a
    // build where the pill never moves at all.
    name: "The contents pill's label follows the reader down a long page",
    scenes: ["docs-many-headings"],
    check: async (page) => {
      const labelAt = async (fraction: number) => {
        await page.evaluate((f) => {
          const el = document.querySelector(".docs-shell") as HTMLElement | null;
          el?.scrollTo({ top: el.scrollHeight * f });
        }, fraction);
        await page.waitForTimeout(500);
        return page.evaluate(() => {
          const pill = [...document.querySelectorAll("button")].find((b) => b.querySelector(".toc-label"));
          return pill?.querySelector(".toc-label")?.textContent?.trim() ?? null;
        });
      };
      const mid = await labelAt(0.45);
      const bottom = await labelAt(0.95);
      if (mid === null || bottom === null)
        return one("", "page.toc_pill_label", "a labelled pill at two scroll depths", "none found");
      return mid !== bottom
        ? null
        : one("", "page.toc_pill_label", "a different heading named further down the page", `“${mid}” at both depths`);
    },
  },
  {
    id: "layout",
    name: "A code panel keeps clear of the sidebar, by no more than its own stated overhang",
    scenes: ["docs-node", "docs-vex", "docs-many-headings"],
    check: async (page) => {
      const info = await page.evaluate(() => {
        const sidebar = document.querySelector("aside");
        const code = document.querySelector(".code-panel");
        const text = document.querySelector("article.prose > :not(pre):not(header)");
        if (!sidebar || !code || !text) return null;
        const outer = code.closest(".group")?.parentElement;
        const overhang = outer ? Math.abs(Number.parseFloat(getComputedStyle(outer).marginLeft) || 0) : 0;
        return {
          codeGap: Math.round(code.getBoundingClientRect().left - sidebar.getBoundingClientRect().right),
          textGap: Math.round(text.getBoundingClientRect().left - sidebar.getBoundingClientRect().right),
          overhang: Math.round(overhang),
        };
      });
      if (info === null) return null; // no code panel on this page — nothing to check
      const allowed = info.textGap - info.overhang;
      return info.codeGap >= allowed - 1
        ? null
        : one(
            "",
            "layout.code_gap",
            `at least ${allowed}px between the sidebar and the code panel (the text's own gap, less the panel's stated overhang)`,
            `${info.codeGap}px`,
          );
    },
  },
  {
    id: "controls",
    name: "One word names the kept-page feature everywhere it appears",
    scenes: ["landing-full"],
    check: async (page) => {
      const words = await page.evaluate(() => {
        const hint = [...document.querySelectorAll("footer span")]
          .map((el) => (el.textContent ?? "").trim())
          .find((t) => /^(bookmark|keep|save|favorite)/i.test(t));
        const tab = [...document.querySelectorAll('[role="tab"]')]
          .map((el) => (el.textContent ?? "").trim())
          .find((t) => /bookmark/i.test(t));
        const strip = document.querySelector('aside a[href*="tab=bookmarks"]')?.textContent?.trim();
        const rowLabel = document.querySelector('main button[aria-pressed]')?.getAttribute("aria-label");
        return { hint, tab, strip, rowLabel };
      });
      const values = Object.values(words).filter((v): v is string => !!v);
      const bad = values.filter((v) => !/bookmark/i.test(v));
      return bad.length === 0
        ? null
        : one("", "controls.naming", 'every one of them naming the feature "bookmark"', bad.join(", "));
    },
  },
];

/* ─────────────────────────────── the runner ────────────────────────────── */

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(base: string, tries = 60) {
  for (let at = 0; at < tries; at += 1) {
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`no answer from ${base}`);
}

async function main() {
  const args = process.argv.slice(2);
  const only = flag(args, "--only");
  const given = flag(args, "--port");

  if (!args.includes("--no-build") && !given) {
    const build = spawnSync("bun", ["run", "build"], { stdio: "inherit", shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
    const probe = spawnSync("cargo", ["build", "--example", "probe"], {
      cwd: "src-tauri",
      stdio: "inherit",
      shell: true,
    });
    if (probe.status !== 0) process.exit(probe.status ?? 1);
  }

  const port = given ? Number(given) : await freePort();
  let server: ChildProcess | null = null;
  if (!given) {
    server = spawn("src-tauri/target/debug/examples/probe.exe", ["--serve", String(port), "--dist", "dist"], {
      stdio: "ignore",
    });
  }
  const base = `http://localhost:${port}/`;

  if (existsSync(OUT)) recycle(resolve(OUT));
  mkdirSync(OUT, { recursive: true });

  let browser: Browser | null = null;
  const findings: Finding[] = [];
  let ran = 0;

  try {
    await waitForServer(base);
    browser = await chromium.launch();

    for (const scene of SCENES) {
      const checks = AREAS.filter(
        (area) => area.scenes.includes(scene.name) && (!only || area.id === only),
      );
      if (checks.length === 0) continue;

      const context = await browser.newContext({
        viewport: scene.size ?? WIDE,
        colorScheme: scene.theme ?? "light",
        deviceScaleFactor: 2,
      });
      const page = (await context.newPage()) as Page & { __errors?: string[] };
      page.__errors = [];
      page.on("console", (message) => {
        if (message.type() === "error") page.__errors!.push(message.text().slice(0, 160));
      });
      page.on("pageerror", (error) => page.__errors!.push(String(error).slice(0, 160)));
      // The console says a request failed but not which one, so the path is
      // read off the response itself.
      page.on("response", (response) => {
        if (response.status() === 404) page.__errors!.push(`404 ${new URL(response.url()).pathname}`);
      });

      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      await scene.open(page);
      // A scene opens by clicking, and the pointer stays where it clicked, so
      // the row under it wears its hover fill in the shot and in every colour
      // a check reads. Park the pointer off every control first.
      await page.mouse.move(2, 2);
      // An icon still fetching draws its skeleton, so a shot taken too early
      // says "no icon" about a sidebar that has one. Wait for the last one.
      await page
        .waitForFunction(() => !document.querySelector('[data-doc-icon][data-image-state="skeleton"]'), null, {
          timeout: 10_000,
        })
        .catch(() => {});
      await page.waitForTimeout(400);

      await page.screenshot({ path: `${OUT}/${scene.name}.png`, fullPage: false });

      for (const area of checks) {
        ran += 1;
        let result: Finding[] | Finding | null = null;
        try {
          result = await area.check(page);
        } catch (reason) {
          result = one("", area.id, area.name, `the check itself failed: ${reason}`);
        }
        const list = result === null ? [] : Array.isArray(result) ? result : [result];
        for (const finding of list) findings.push({ ...finding, scene: scene.name });
      }

      await context.close();
    }
  } finally {
    await browser?.close();
    server?.kill();
  }

  const report = {
    at: new Date().toISOString(),
    checks: ran,
    failed: findings.length,
    findings,
  };
  writeFileSync(`${OUT}/report.json`, `${JSON.stringify(report, null, 2)}\n`);

  if (findings.length === 0) {
    console.log(`${ran} checks, all clean. Shots in ${OUT}/`);
    return;
  }

  console.log(`${ran} checks, ${findings.length} failed:\n`);
  for (const finding of findings) {
    console.log(`  ${finding.scene} — ${finding.check}`);
    console.log(`    want: ${finding.want}`);
    console.log(`    got:  ${finding.got}`);
  }
  console.log(`\nShots in ${OUT}/`);
  process.exitCode = 1;
}

if (!existsSync("harness")) {
  console.error("run this from the repo root");
  process.exit(2);
}

await main();
