# Testing

Test your change. Do not commit the test.

Write the smallest check that fails if the logic breaks, run it, read the
result, then delete it. A test written for one change is waste in the tree: it
adds files to read, it goes stale, and nobody runs it again.

Keep a test only if the user asks for it, or if it protects logic that a person
cannot check by hand and that will change again. The unit tests in
`src-tauri/src/assets.rs` and in the `wiki` crate are that kind: a path rule
and a markup rule, each with a case that used to be wrong.

Scratch scripts, smoke tests, and one-off harnesses go in a temporary
directory, never in the repo.

## Rust

```bash
cd src-tauri && cargo test
```

`cargo fmt` reformats the whole crate, not your change, because the code was
written against an older rustfmt. Format by hand, or revert the files your
change does not belong to. Check `git diff --stat` after every edit: a stat far
larger than the edit means a formatter or a line-ending flip, not real work.

## Front-end

Three levels, cheapest first.

1. `bun run build` — `tsc --noEmit` then Vite. Catches your own type errors
   with no runtime at all.
2. The built `dist/` in a browser with `window.__TAURI_INTERNALS__` stubbed.
   This runs the real bundle and the real component tree, and it is the only
   way to look at a page from an agent session on this machine. See
   [Front-end](frontend.md).
3. `bun run app` — the real window on the real install. The user runs this.

## macOS

There is no Mac on this machine. The `macos-check` workflow is one: a dispatch
runs a command there after the build, and keeps `out/` as the artifact. The
checks in `harness/mac/` drive the real window with System Events and compare
screenshots. Read the workflow's header for the commands.

Never drive a window on this machine with the mouse or the keys: the user works
here while tests run. Playwright runs headless, and `harness/app.mts` starts
the app with `--background`, so its window never shows.

## Fixtures

Prefer a real check over a mock. A page is only confirmed against a real page
out of a real Houdini install.

Read it at test time from `$HFS/houdini/help`. **Never save one into the
repo.** No page, no picture, no snapshot of either. See [Content](content.md).
