# AGENTS.md

Project information: @README.md

## Guides

- [Architecture](agents/architecture.md) — the four layers, and which file owns what.
- [Deployment](agents/deployment.md) — the app does not deploy. The site still does.
- [Content](agents/content.md) — the docs come from the Houdini install, not from here.
- [Code](agents/code.md) — one source of truth, small modules, no legacy paths.
- [Front-end](agents/frontend.md) — the design language, and how to look at a change.
- [Testing](agents/testing.md) — test the change, do not commit the test.
- [Issues](agents/issues.md) — where specs live.
- [Houdini's help pane](agents/houdini-pane.md) — an old Chromium, and how to debug it from the outside.

## Rules

- Read the documentation before you write code against a service, quote a rate,
  or state a limit. Do not answer from memory. Prefer the site's own `llms.txt`
  or `index.md`; otherwise prefix the link with `markdown.new/` for clean raw
  text. Cloudflare publishes every page as `<url>/index.md`.
- One source of truth, in code and in UI. A value, a rule or a control that
  shows in two places lives in one module that both import — see
  [Code](agents/code.md).
- No single-letter variable names. `xPosition` instead of `x`. `iteration` instead of `i`.
- Use ASD-STE100 Simplified Technical English in all writing: replies, comments,
  commits, pull requests.
- Do not keep backward compatibility. Delete the old path. Do not add fallbacks,
  shims, or migrations.
- Do not write documentation that a person can get from the code. Write a short
  comment in the code instead.
- Do not record a fact that goes stale: page counts, version numbers, file
  inventories, benchmark tables, audit results. Point to the code that holds it.
- Do not publish, commit, or push SideFX content or any other copyrighted
  material. This includes doc pages, test fixtures made from doc pages, images
  from the Houdini install, and examples quoted at length. Make test fixtures on
  the machine that runs the test and keep them out of version control.
- Do not add a file to this repo unless the product needs it. Scratch work goes
  in a temporary directory.
- Do not commit SQL migration files. Write them in `migrations/`, apply, then delete
  the file.
- A release page holds the installers, the macOS updater bundle and
  `latest.json`, and nothing else. The macOS updater reads the app as a
  `.app.tar.gz`, not the disk image, so that file must be there. Never put a
  `.sig` file on it: the signature the app checks is inside `latest.json`, so
  the file is a second copy that nothing reads.
- Every commit that changes the shipped app adds its line to the open release
  note in the vault, in the same turn. The release note is the changelog. To
  find the right note, see [Deployment](agents/deployment.md#release-notes).
- Look at a UI change before you report it done. A build that compiles is not a
  page that reads.
- This machine has an interactive desktop. To look at the app, serve the built `dist` with a
  stub for those internals — see [Testing](agents/testing.md).
- When you change the parser or the renderer, check the shape on a family of
  pages, not on the one page that showed the bug — see
  [Content](agents/content.md).