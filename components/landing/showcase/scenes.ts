/**
 * What the pointer does in each tab that shows the app. Every step is a step a
 * reader takes; the page it opens is timed by the page itself.
 */
import type { Driver } from "@/components/landing/showcase/driver";

/** The search over a page, which Ctrl K opens. */
const OVERLAY = 'input[type="search"]';

/** A page, drawn at once: a scene starts in the app, not on its home screen. */
async function onPage(d: Driver, path: string, title: string) {
  d.hide();
  if (d.win.location.pathname !== `/${path}`) d.go(`/${path}`);
  await d.waitFor(() => d.pageTitle() === title);
}

/** The home screen and its recent pages, one opened, its picture full
    screen, a link with its preview, the page kept, and the next page through
    the sidebar: every page opens and is timed. */
export async function navigationScene(d: Driver) {
  d.hide();
  if (d.win.location.pathname !== "/") d.go("/");
  const card = await d.waitFor(() => d.$('main a[aria-label="Scatter"]'));
  // The reader looks over the list before taking a page from it.
  await d.sleep(1400);
  await d.point(card, { dwell: 300 });
  await d.open(card, "Scatter");
  await d.sleep(1600);

  const article = () => d.$("article")!;
  const picture = await d.waitFor(() => article().querySelector("img.markdown-media"));
  await d.point(picture, { dwell: 200 });
  await d.press(picture);
  await d.sleep(1300);
  await d.key("Escape", { label: "Esc" });
  await d.sleep(300);

  const inline = await d.waitFor(() => d.byText("Copy to Points", "a", article()));
  // Long enough to read the link's preview.
  await d.point(inline, { dwell: 800 });
  await d.open(inline, "Copy to Points");
  await d.sleep(700);

  // Kept: the page takes its place under Bookmarks in the sidebar. A second
  // round finds it kept, and Ctrl D would take it off again.
  if (!d.$('button[aria-pressed="true"][aria-label="Remove the bookmark"]')) {
    await d.key("d", { label: "Ctrl D" });
    await d.sleep(600);
  }

  // The next page, through the sidebar: the open folder folds away, and
  // another opens onto the page. A phone has no sidebar, and takes the link.
  const aside = d.$("aside");
  if (!aside?.offsetWidth) {
    const wrangle = await d.waitFor(() => d.byText("Attribute Wrangle", "a", article()));
    await d.open(wrangle, "Attribute Wrangle");
  } else {
    for (const label of ["Geometry", "Utility"]) {
      await d.press(await d.waitFor(() => folder(d, aside, label)));
      await d.sleep(350);
    }
    const row = await d.waitFor(() => d.byText("Attribute Wrangle", "a", aside));
    await d.point(row, { dwell: 150 });
    await d.open(row, "Attribute Wrangle");
  }
  await d.sleep(1200);
}

/** A folder row of the sidebar, by its name. Its count is part of its text,
    and a folder with rows open repeats as the list's sticky heading, kept
    under the rows above it: the row is the one a hand can reach. */
const folder = (d: Driver, aside: HTMLElement, label: string) =>
  [...aside.querySelectorAll<HTMLElement>("button[aria-expanded]")].find(
    (el) => el.textContent?.trim().replace(/[\d,]+$/, "") === label && d.shows(el),
  );

/** Ctrl K over the page the reader is on: a node, then a VEX function by its
    scope, which opens. */
export async function searchScene(d: Driver) {
  if (d.win.location.pathname === "/") await onPage(d, "nodes/sop/attribwrangle", "Attribute Wrangle");
  d.hide();
  await d.sleep(300);
  await d.key("k", { label: "Ctrl K" });
  const field = await d.waitFor(() => d.$(OVERLAY) as HTMLInputElement | null);
  await d.type(field, "scatter");
  await d.sleep(500);
  await d.key("ArrowDown", { label: "↓" });
  await d.key("ArrowDown", { label: "↓" });
  await d.clear(field);
  await d.type(field, "vex: noise");
  await d.sleep(700);
  await d.open(() => d.key("Enter", { label: "Enter" }), "noise");
  await d.sleep(1500);
}

/** Settings over a page: a few accents, then a hue of the reader's own on its
    slider, then the page width. While a knob is held, Settings steps aside
    and the page behind it takes the change. */
export async function customizationScene(d: Driver) {
  await onPage(d, "nodes/sop/copytopoints", "Copy to Points");
  await d.sleep(500);
  // The gear in the sidebar's foot; a phone has no sidebar, and takes the keys.
  const gear = d.$('aside button[aria-label="Settings"]');
  const phone = !gear?.offsetWidth;
  if (phone) await d.key(",", { label: "Ctrl ," });
  else await d.press(gear);
  const dialog = await d.waitFor(() => d.$('[role="dialog"]'));
  await d.sleep(600);

  const swatch = (name: string) => d.waitFor(() => dialog.querySelector<HTMLElement>(`button[role="radio"][aria-label="${name}"]`));
  for (const name of ["Blue", "Green"]) {
    await d.press(await swatch(name));
    await d.sleep(650);
  }
  await d.press(await swatch("Custom"));
  const hue = await d.waitFor(() => d.$('input[aria-label="Hue"]') as HTMLInputElement | null);
  await d.sleep(400);
  await d.slide(hue, [
    { to: 175, ms: 1100 },
    { to: 345, ms: 1000 },
  ]);
  await d.sleep(500);

  // A phone's page is narrower than the narrowest width: the slider would
  // change nothing there.
  if (!phone) {
    await d.press(await d.waitFor(() => d.byText("Reading", "button", dialog)));
    const width = await d.waitFor(() => d.$('input[aria-label="Page width"]') as HTMLInputElement | null);
    await d.sleep(500);
    await d.slide(width, [
      { to: 118, ms: 1200 },
      { to: 92, ms: 900 },
    ]);
    await d.sleep(400);
  }

  await d.key("Escape", { label: "Esc" });
  await d.sleep(1600);
}
