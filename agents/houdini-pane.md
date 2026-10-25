# Houdini's help pane

F1 opens the page in Houdini's embedded browser (QtWebEngine). This is not the
app's webview. This is not a current browser. Houdini 21's QtWebEngine 6.5.3
contains Chromium 108 (December 2022). Chromium 108 is older than the Houdini
release by years. Code in the help pane must work on Chromium 108. Code must
not require a newer Chromium.

## Test features — do not assume they exist

A JS or CSS feature released after Chromium 108 does not cause an error in
Chromium 108. Instead, it returns `undefined` (JavaScript) or fails to parse
(CSS). No exception appears. No console warning appears. Two examples:

- `URLSearchParams.prototype.size` (Chrome 116+, released mid-2023) returned
  `undefined`. The code `query.size ? '?'+query : ''` always followed the empty
  branch. Every argument in every API call from inside Houdini's pane was lost.
  Arguments lost: page path, search term, bookmark title. Fix: use `.toString()`
  to build the query instead. The desktop window did not show this bug. The
  desktop window uses Tauri's IPC, not the HTTP fallback in `src/lib/backend.ts`.
  The bug only appeared in Houdini's pane.
- `oklch()` and `color-mix()` (Chrome 111+, released March 2023) are the default
  colors in Tailwind 4. Chromium 108 cannot parse these functions. The CSS
  declaration is invalid. The color, gradient, border, or background has no
  value. This is why colors in the pane look broken, but colors in the desktop
  window look correct. Same CSS, different engine. Fixed with
  `postcss.config.js` — see below.

Before you use a newer JS or CSS feature in the help pane, check the feature on
MDN or on caniuse.com. Check for Chromium 108 support. Do not check for support
in your own browser.

## Debug the pane from outside

The pane has no devtools. To see what the pane sends:

1. Log all request details in `server.rs` in the request loop. Log method, URL,
   and headers. Log all requests. Do not skip requests based on build type.
2. Send the same request with `curl` by hand. If `curl` returns the correct
   answer and the pane does not, the bug is in the client. The bug is in the
   pane's JavaScript or in Chromium 108. The bug is not in the server. You can
   trust `install::resolve` and all Rust commands once you confirm the endpoint
   works with `curl`.
3. A query string never shows the parameter you added. This means the code that
   passes arguments does nothing. The bug is not a race condition. The bug is
   not a stale build. Verify the build contains your change. Search the file
   `dist/assets/*.js` for the string you added. Search for the exact string.

## One `Install` instance — shared

The window (Tauri IPC) and the localhost server (background thread for Houdini's
pane) both read the same install. Both must read the same `Arc<install::Chosen>`
and the same `Arc<install::Cache>`. Do not create two separate copies that start
with the same values. If the window changes the build or if you pick a folder by
hand, the other side does not see the change until the old install cache is
removed from disk. This can take a very long time. `install::Chosen` owns the
lock. Callers pass in a shared handle. Callers do not keep their own
`Option<Install>` copy.

## Legacy color fallback

`postcss.config.js` runs `@csstools/postcss-oklab-function` and
`@csstools/postcss-color-mix-function` over the built CSS, both with
`preserve: true`. These are the same polyfills `postcss-preset-env` uses, from
the people who write the CSS Color 4 spec — do not hand-write a fallback
palette. Each rewrites one declaration into two: a plain `rgb()` line first,
then the original `oklch()`/`color-mix()` line wrapped in
`@supports (color: oklab(0% 0 0))`. Chromium 108 cannot parse the `@supports`
condition, so it never reaches the modern line and keeps the `rgb()` one. A
current engine reads past it and gets the real color. No branch on `inTauri`,
no hand conversion of `src/styles/globals.css` — the same built CSS degrades
on its own wherever it runs.

## A fallback that resolves does not mean a fallback that reads

`--callout-surface: color-mix(in oklab, var(--callout-color) 4%, var(--card))`
has two inputs, and one of them is itself a variable — the plugin cannot fold
that at build time the way it folds a literal color, so its fallback tier is
just `var(--callout-color)`, the flat brand color, not a tint of it. That is a
correct, working CSS declaration. It is also the same color the title text,
the icon and the links in that callout ALSO fall back to — so on Chromium 108
the "Note" callout was fully readable by every tool that checks a computed
style (a real background-color, a real color, `getBoundingClientRect().width
> 0`, real text in `textContent`) and fully invisible on screen, because the
text was drawn in its own background. Reading a computed style back proves a
declaration parsed. It proves nothing about whether two declarations, each
individually fine, describe something a reader can see. Check contrast
between a foreground and the background it actually sits on, not that each
one individually "has a color" — `harness/pane.mts`'s `title-contrast` check
does this by comparing the two computed colors directly. Fixed by giving the
title, the icon and the link their own fallback tier (`var(--card-foreground)`,
already proven readable against everything) instead of letting them default
to whatever the surface degraded to.

## Static blend, not a fallback

`color-mix()` of two FIXED colors is not "live" — it never changes at
runtime. Compute it once, write the literal. Do not write
`color-mix(in oklab, var(--x) 4%, var(--y))` even inside your own
`@supports` gate: the fallback plugin still sees the unresolved `var()`
inside it and inserts its OWN fallback — `var(--x)`, ungated, wins the
cascade in every engine regardless of your `@supports`. Old and new engines
should get the identical pixel here, not an approximation one is worse than.

## `harness/pane.mts` — Houdini's pane, recreated

`node harness/pane.mts` finds every Houdini install this machine's registry
names, reads each one's real QtWebEngine version off its own DLL, and — for
the ones this file has a Chromium version confirmed for (see
`CONFIRMED_CHROMIUM` in the file) — runs the real server (`server.rs`, not a
stub) through a downgrade shim built from `GAPS`, so this run's own (current)
Playwright Chromium renders and behaves the way that Houdini's pane actually
does. It opens the same real page twice per scene, shimmed and not, and
screenshots both into `harness/out/pane/`. Run it after any change that
touches `src/lib/backend.ts`, `postcss.config.js`, or anything else in the
request path Houdini's pane uses that the desktop window's Tauri IPC does
not — that boundary is exactly where every bug in this file was found. Add a
gap to `GAPS` and a scene to `SCENES` the same way the two here were added:
from something a real Houdini pane was seen to get wrong, not from a guess.

It starts the app through `launch` in `harness/app.mts` and asks that process
for its port (`server_port`). A scan of the ports from 48800 cannot tell a
reader's own app, or another build, from this run's: it silently adopted one
once, and every check that run reported passed against a build from an hour
earlier.

## Build the app with `tauri build`, not `cargo build --release`

`cargo build --release --bin nodebookmd` alone produces a binary that still
loads `http://localhost:1420`, the Vite dev server — not the bundled UI.
Tauri decides dev or prod from its own `custom-protocol` Cargo feature, set
by the `tauri` CLI, not from the release profile. The binary looks fine (it
is optimized, no debug assertions) and runs fine as long as a dev server
happens to be reachable at that port — then fails with "connection refused"
the moment it is not, such as after a normal quit and relaunch with no dev
server running. Confirm which URL a built window actually loaded with
WebView2's own devtools: set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`
before launching, then `curl http://localhost:9333/json` — a `url` of
`http://tauri.localhost/` is correct, `http://localhost:1420/` is not. Always
build a binary to hand to a reader with `bun run app:build`.