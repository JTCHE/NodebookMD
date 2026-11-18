// The app's back end, for the copy of the app on the landing page.
//
// `/demo/app/` is the desktop app's own front end, built from its repository
// by `scripts/build-demo.ts`. In the desktop window Tauri answers its commands
// from the Houdini install. Here this file answers them: page titles from
// `titles.json`, and page bodies from `pages/`, which are written for this
// site. No SideFX text and no SideFX picture is served.
//
// It runs before the app's bundle, so the app starts as if it were in its own
// window.
(() => {
  const BASE = "/demo/";
  /** The app release built into `/demo/app/`. */
  const VERSION = "0.4.0";

  /* The look the tour changes: the accent and the page as Settings sets
     them, kept by the app in local storage. Every visit and every tab of the
     tour starts on the app's defaults. The theme is the site's, and stays. */
  const LOOK = ["nodebookmd.accent", "nodebookmd.accent-hue", "nodebookmd.text-size", "nodebookmd.measure"];
  const plainLook = () => {
    for (const key of LOOK) {
      try {
        if (localStorage.getItem(key) === null) continue;
        localStorage.removeItem(key);
      } catch {
        return;
      }
      // The app repaints on a storage event, which another window sends.
      dispatchEvent(new StorageEvent("storage", { key }));
    }
  };
  plainLook();
  window.__demo = { plainLook };

  /* The app is a single page with real paths. Its moves must not reach the
     page around it, or the browser's Back button would walk the demo instead
     of leaving the site. So the frame keeps its own trail and only ever
     replaces its one history entry. */
  const real = {
    replace: history.replaceState.bind(history),
  };
  const trail = [{ state: null, url: "/" }];
  let at = 0;
  real.replace(null, "", "/");
  history.pushState = (state, _title, url) => {
    trail.splice(at + 1);
    trail.push({ state, url: url ?? location.pathname });
    at += 1;
    real.replace(state, "", url);
  };
  history.replaceState = (state, _title, url) => {
    trail[at] = { state, url: url ?? location.pathname };
    real.replace(state, "", url);
  };
  history.go = (delta = 0) => {
    const to = at + delta;
    if (to < 0 || to >= trail.length || delta === 0) return;
    at = to;
    real.replace(trail[at].state, "", trail[at].url);
    setTimeout(() => dispatchEvent(new PopStateEvent("popstate", { state: trail[at].state })));
  };
  history.back = () => history.go(-1);
  history.forward = () => history.go(1);

  /* The data. */
  const json = (path) => fetch(BASE + path).then((answer) => answer.json());
  let titles = null;
  /** The title list, with a line under the titles this site wrote one for,
      and a stand-in row for every page it left out (`counts.json`), so the
      sidebar counts what an install holds. A stand-in is never drawn: its
      folder is shut, see `shut`. */
  const allTitles = () =>
    (titles ??= Promise.all([
      json("titles.json"),
      json("pages/summaries.json"),
      json("pages/index.json"),
      json("counts.json"),
    ]).then(([all, lines, pages, counts]) => {
      const rows = all.map((row) => {
        const summary = pages[row.path]?.summary ?? lines[row.path];
        return summary ? { ...row, summary } : row;
      });
      let n = 0;
      for (const [key, count] of Object.entries(counts)) {
        const [branch, ...place] = key.split("|");
        for (let i = 0; i < count; i++) {
          // A long path of blanks: a search that reaches a stand-in at all
          // (by its section) ranks it after every real page, and `hide`
          // takes it off the list.
          rows.push({ path: `${branch}/${STAND_IN}${n++}`, title: STAND_IN, place: place.length ? place : undefined, standIn: true });
        }
      }
      open = new Set([
        ...OPEN,
        ...all.flatMap((row) => row.place ?? []),
        ...all.filter((row) => /^[^/]+\/index$/.test(row.path)).map((row) => row.title),
      ]);
      return rows;
    }));

  /* The folders the tour opens, by the label the sidebar gives them: the
     groups, and the branches that hold a page this site keeps. The app names
     these two itself (`src/lib/landing/tree.ts`). Every other folder holds
     stand-ins only, and a press on it does nothing. */
  const OPEN = ["Nodes", "Languages", "Learn", "Reference", "Geometry — SOP", "VEX"];
  let open = new Set(OPEN);
  /** The title and path mark of a stand-in: blanks nobody types. */
  const STAND_IN = "⠀".repeat(24);
  // A search result that is a stand-in draws as no row.
  new MutationObserver(() => {
    for (const row of document.querySelectorAll("button")) {
      if (row.textContent.startsWith(STAND_IN) && row.style.display !== "none") row.style.display = "none";
    }
  }).observe(document, { subtree: true, childList: true });

  const shut = (event) => {
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    // A folder row, not a menu button such as the version picker.
    const row = event.target.closest?.('button[aria-expanded="false"]:not([aria-haspopup])');
    const label = row?.querySelector("span.truncate")?.textContent?.trim();
    if (!label || open.has(label)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ["pointerdown", "mousedown", "click", "keydown"]) addEventListener(type, shut, true);
  let written = null;
  /** The pages this site wrote: path to { title, summary }. */
  const writtenPages = () => (written ??= json("pages/index.json"));
  /** A written page's Markdown, read once. The few pages are read as the app
      starts: a page the tour opens then draws in the frame the search closes
      in, not a round trip later. */
  const bodies = new Map();
  const markdownOf = (path) => {
    if (!bodies.has(path)) bodies.set(path, fetch(`${BASE}pages/${path}.md`).then((answer) => answer.text()));
    return bodies.get(path);
  };
  void writtenPages().then((mine) => Object.keys(mine).forEach(markdownOf));

  const INSTALL = {
    version: "21.0.829",
    root: "C:\\Program Files\\Side Effects Software\\Houdini 21.0.829",
    help: "C:\\Program Files\\Side Effects Software\\Houdini 21.0.829\\houdini\\help",
    packages: [],
  };
  const PORT = 48800;

  /* Settings, made from `INSTALL` so the version picker and the settings say
     the same build. F1 already opens the app, and two agents run Houdini MCP:
     the state of a machine after the setup. */
  const series = INSTALL.version.split(".").slice(0, 2).join(".");
  const hooked = new Set([series]);
  const releases = () =>
    [series].map((release) => ({
      release,
      url: hooked.has(release) ? `http://127.0.0.1:${PORT}` : null,
      external: hooked.has(release),
      ours: hooked.has(release),
    }));
  const hook = (on) => ({ releases: list }) => {
    for (const release of list) on ? hooked.add(release) : hooked.delete(release);
    return list;
  };
  /** As the app's `mcp::agents` names them. */
  const AGENTS = [
    { key: "claude", label: "Claude", link: "ours" },
    { key: "codex", label: "OpenAI Codex", link: "none" },
    { key: "opencode", label: "opencode", link: "ours" },
  ];
  const VAULTS = [{ path: "C:\\Users\\you\\Documents\\Houdini notes", name: "Houdini notes" }];

  /** On top of every page this site wrote, so no reader takes it for SideFX's. */
  const SAMPLE =
    "> [!NOTE]\n>\n> This is a sample page, written for this site. The app shows the official documentation, from your local install.\n\n";

  const settings = new Map([
    ["onboarded", "done"],
    // The release is not news here: no "Updated to" pill on the home page.
    ["seen_version", VERSION],
    ["obsidian-vault", VAULTS[0].path],
  ]);
  const recents = [];
  const bookmarks = [];
  const now = Date.now();

  /** A page this site did not write: the app's own page shape, and a line
      that says where the real one comes from. */
  function stand(hit, path) {
    const name = hit?.title ?? path.split("/").pop();
    return {
      path,
      name,
      nodeType: hit?.nodeType ?? undefined,
      markdown:
        `> [!NOTE]\n>\n> This copy of the app holds a few pages written for this site. ` +
        `The app on your machine reads **${name}** from your own Houdini install, ` +
        `with every one of its other pages.\n\n` +
        `Try [Scatter](/nodes/sop/scatter), [Attribute Wrangle](/nodes/sop/attribwrangle) ` +
        `or [noise](/vex/functions/noise).\n`,
      version: INSTALL.version,
      nodeVersions: [],
    };
  }

  /** An index page, made from the titles under it and nothing else: a list
      of links, in the sidebar's folders. */
  function contents(all, hit, path) {
    const root = path.slice(0, -"index".length);
    const folders = new Map();
    for (const row of all) {
      if (row.standIn || !row.path.startsWith(root) || row.path.endsWith("/index")) continue;
      const folder = row.place?.join(" › ") ?? "";
      if (!folders.has(folder)) folders.set(folder, []);
      folders.get(folder).push(`- [${row.title}](/${row.path})`);
    }
    const markdown = [...folders].map(([folder, links]) => (folder ? `## ${folder}\n\n` : "") + links.join("\n")).join("\n\n");
    return {
      path,
      name: hit.title,
      markdown,
      version: INSTALL.version,
      nodeVersions: [],
    };
  }

  async function page({ path }) {
    const clean = String(path)
      .replace(/^\/+|\/+$/g, "")
      .replace(/#.*$/, "");
    const [all, mine] = await Promise.all([allTitles(), writtenPages()]);
    const hit = all.find((row) => row.path === clean);
    const own = mine[clean];
    if (!own && hit && clean.endsWith("/index")) return contents(all, hit, clean);
    if (!own) {
      if (!hit) throw new Error(`missing: ${clean}`);
      return stand(hit, clean);
    }
    const markdown = await markdownOf(clean);
    return {
      path: clean,
      name: own.title,
      nodeType: hit?.nodeType ?? undefined,
      summary: own.summary,
      markdown: SAMPLE + markdown,
      version: INSTALL.version,
      nodeVersions: [],
    };
  }

  /** Full-text search over the pages this site wrote. The app ranks titles
      on its own; this is only the part Rust does. */
  async function search({ query }) {
    const words = String(query ?? "")
      .toLowerCase()
      .replace(/^[a-z]+:\s*/, "")
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    const [all, mine] = await Promise.all([allTitles(), writtenPages()]);
    const hits = [];
    for (const [path, own] of Object.entries(mine)) {
      const text = await markdownOf(path);
      const sections = text.split(/\n(?=## )/);
      const headings = [];
      let score = 0;
      for (const section of sections) {
        const lower = section.toLowerCase();
        if (!words.every((word) => lower.includes(word))) continue;
        const heading = section.startsWith("## ") ? section.slice(3, section.indexOf("\n")).trim() : "";
        const body = section.slice(heading ? section.indexOf("\n") + 1 : 0);
        const at = body.toLowerCase().indexOf(words[0]);
        const excerpt = (at > 40 ? "…" : "") + body.slice(Math.max(0, at - 40), at + 100).trim() + "…";
        headings.push({ heading, slug: heading.toLowerCase().replace(/[^a-z0-9]+/g, "-"), excerpt });
        score += 1;
      }
      if (!score) continue;
      const hit = all.find((row) => row.path === path);
      hits.push({ path, title: own.title, nodeType: hit?.nodeType ?? null, icon: null, summary: own.summary, headings, score });
    }
    return hits;
  }

  async function meta({ paths }) {
    const list = Array.isArray(paths) ? paths : String(paths ?? "").split(",");
    const [all, mine] = await Promise.all([allTitles(), writtenPages()]);
    return list
      .map((path) => {
        const hit = all.find((row) => row.path === path);
        if (!hit) return null;
        return { path, title: hit.title, summary: mine[path]?.summary ?? null, icon: null };
      })
      .filter(Boolean);
  }

  function remember(list, { path, title }) {
    const at = list.findIndex((entry) => entry.path === path);
    if (at >= 0) list.splice(at, 1);
    const id = now + list.length;
    list.unshift({ id, path, title, icon: null, at: Date.now() });
    return id;
  }

  const COMMANDS = {
    clean_start: () => false,
    installs: () => [INSTALL],
    current_install: () => INSTALL,
    available_installs: async () => [{ version: INSTALL.version, pages: (await allTitles()).length, done: true, current: true }],
    houdini_releases: releases,
    hook_houdini: hook(true),
    unhook_houdini: hook(false),
    index_status: async () => {
      const pages = (await allTitles()).length;
      return { build: INSTALL.version, pages, total: pages, done: true, wrote: false };
    },
    titles: () => allTitles(),
    search,
    // No sample page inherits from a HOM class, and its Markdown is already plain.
    page: async (args) => {
      const view = await page(args);
      return { inheritance: [], portable: view.markdown, ...view };
    },
    meta,
    link_preview: () => null,
    has_example: () => false,
    recents: () => recents,
    bookmarks: () => bookmarks,
    record_visit: (args) => remember(recents, args),
    forget_recent: ({ path }) => {
      const at = recents.findIndex((entry) => entry.path === path);
      if (at >= 0) recents.splice(at, 1);
    },
    toggle_bookmark: (args) => {
      const at = bookmarks.findIndex((entry) => entry.path === args.path);
      if (at >= 0) bookmarks.splice(at, 1);
      else remember(bookmarks, args);
      return at < 0;
    },
    get_setting: ({ key }) => settings.get(key) ?? null,
    set_setting: ({ key, value }) => void settings.set(key, value),
    user_name: () => null,
    server_port: () => PORT,
    mcp_agents: () => AGENTS.map((agent) => ({ ...agent })),
    // The real install downloads; a second is enough to show the button work.
    install_houdini_mcp: async ({ agent }) => {
      await new Promise((done) => setTimeout(done, 1200));
      AGENTS.find((one) => one.key === agent).link = "ours";
    },
    obsidian_vaults: () => VAULTS,
    report_use: () => {},
    report_search: () => {},
    report_error: () => {},
    "plugin:app|version": () => VERSION,
    "plugin:app|name": () => "NodebookMD",
    "plugin:event|listen": () => 0,
    "plugin:event|unlisten": () => {},
    "plugin:event|emit": () => {},
    "plugin:window|is_maximized": () => false,
    "plugin:window|is_fullscreen": () => false,
    "plugin:window|is_focused": () => true,
    "plugin:window|scale_factor": () => window.devicePixelRatio,
    "plugin:window|theme": () => null,
  };

  let callbacks = 0;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    plugins: {},
    transformCallback: () => ++callbacks,
    unregisterCallback: () => {},
    // SideFX's icons stay in the install. An empty address fails at once, with
    // no request, and the app draws its own page glyph in the icon's place.
    convertFileSrc: (path, protocol) => (protocol === "hicon" ? "data:," : `${BASE}${protocol}/${path}`),
    async invoke(command, args = {}) {
      const run = COMMANDS[command];
      // A window move, a caption button, a link out: nothing to do in a frame.
      if (!run) return null;
      return run(args);
    },
  };
})();
