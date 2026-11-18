# Deployment

`main` is the desktop app. It ships through GitHub Releases, for Windows,
Linux and macOS, and GitHub Releases is also the update channel.

## The pipeline

One workflow, `.github/workflows/release.yml`, on a `v*` tag.

1. Push a tag. Nothing else starts a release.
2. `tauri-action` builds the Windows installer, signs it with the updater
   key, writes `latest.json` and opens a **draft** release.
3. The Linux job builds beside it. `publish` adds the AppImage to the draft
   and its entry to `latest.json`.
4. macOS is built on the Mac, not in CI: the GitHub macOS runner costs
   money. On the Mac, `bun run tauri build --bundles app`, pack the `.app`
   as `<productName>_<version>_aarch64.app.tar.gz` (`tar -czf`, the `.app`
   at its root) and the disk image with `src-tauri/dmg/build.sh`. Upload
   both to the draft, then run `gh workflow run macos-sign.yml -f
   tag=v<version>`: it signs the tarball and adds `darwin-aarch64` to
   `latest.json`.
5. The draft now holds the files in the table below.
6. You paste the release notes into the draft and publish it. Then set the
   note's `Status` to `Closed` and fill its `Date`.
7. Publishing is what starts the update. Installed copies read
   `releases/latest/download/latest.json` on their next launch.

## What reaches GitHub

These files, and nothing else:

| file | what it is |
| --- | --- |
| `<productName>_<version>_x64-setup.exe` | the Windows installer |
| `<productName>_<version>_amd64.AppImage` | the Linux app |
| `<productName>_<version>_aarch64.dmg` | the macOS disk image, for a download |
| `<productName>_<version>_aarch64.app.tar.gz` | the macOS app as the updater reads it |
| `latest.json` | the newest version, where to get it, and its signature |

The macOS app is ad-hoc signed, not notarized. A reader opens it the first
time through System Settings, Privacy & Security, Open Anyway. A Developer ID
certificate and notarization remove that step; the secrets they need are in
the "macOS Support & Build in CI Releases" spec.

The `.sig` file Tauri writes is **not** uploaded (`uploadUpdaterSignatures:
false`). The signature the app checks is inside `latest.json`; the `.sig` file
is a second copy that nothing reads, and beside the installer it asks the
reader a question they cannot answer.

GitHub adds `Source code (zip)` and `Source code (tar.gz)` on publish. That
cannot be turned off.

## Why the release is not a prerelease

`releases/latest` skips drafts and prereleases. An installed copy asking for
`releases/latest/download/latest.json` cannot see either one. A beta that no
installed copy can find is not an update channel, so beta builds go out as
ordinary releases with a beta version number.

The draft step stays, because it is where the notes are written.

## Release notes

Write them in the vault, under `side projects/Houdini/NodebookMD/specs/Release/`, one
file per version: `Open/` while the version is not out, `Closed/`
once it is published. CI cannot read the vault — it is in iCloud — so the file is
the source and the GitHub release body is a copy. Paste it into the draft
before publishing.

The note must include `Type: Release`, `Version`, `Date`, and `Status` in its frontmatter.

### Which note to write to

The notes are the changelog. Every commit that changes the shipped app adds
its line in the same turn. A change that does not ship (harness, CI, agent
guides) gets no line. `Open/` holds one note at most, and that note is the one
to write to. Follow these steps in order:

1. One note in `Open/`: run `gh release view v<its Version> --json isDraft`.
   No release, or `isDraft: true`: add the line to that note. Stop.
   A published release: the note is stale. Set `Status: Closed` and its
   `Date`, then go to step 2.
2. No note in `Open/`: take the highest `Version` in `Closed/`, add one to
   its patch number, and create `Open/v<that version>.md` with `Status: Open`
   and an empty `Date`. Add the line there.

Never write to a `Closed` note, and never open a second note. A larger version
jump (minor or major) is the user's decision: rename the open note's file and
`Version` when they make it.

The note mover plugin reads `Status` and files the note under `releases/<Status>`. 
Changing `Status` to `Closed` therefore moves the note. 
Make sure none of these frontmatter fields are missing.

A release note covers one version only.

Write only what changed in that version. Do not describe the project, the product, or previous versions.

Start the note with one or two lines, before any heading, that name the
biggest change in the version. A reader who stops there must know what the
release is about. Example: "The entire user interface has been overhauled: …",
followed by the components that changed.

Organize changes under these headings:

* `## Features` — new or changed functionality: a new control, a new option,
  a redesign. A new slider, a new setting or a new colour system is a feature,
  never a fix.
* `## Fixes` — behavior that was wrong in the last release and is now correct.
  Performance and memory improvements belong here.

Inside each heading, group the lines under `###` categories, for example
`Colour and theme`, `Home`, `Search`, `Sidebar`, `Settings`, `Doc pages`,
`Performance`, `System`, `Privacy`. Name the categories after the area of the
app a reader knows. Omit headings and categories with no items. Do not put
empty lines between the bullets of one list.

Give a large change the weight it has. A change that touches the whole app
(a colour system, a redesign) gets its own category and several lines, not
one line among small ones. Rewrite and regroup the note when the lines added
commit by commit no longer read as one changelog.

### Style

Write every change as a short, objective statement.

* Describe the change directly.
* Do not address the reader as "you".
* Prefer simple, factual sentences.
* Use concise, dead prose.
* Remove explanations that do not clarify the change.
* Include implementation details when they describe a meaningful change or behavior.
* Do not describe the old behavior unless it is needed to make the new behavior clear.
* Avoid narrative, justification, marketing language, and filler.
* Write from the point of view of the last release. Each line says what is
  different from that release: "is now", "now shows", "has been renamed",
  "has been unified into", "no longer". Do not write a bare present tense
  ("is", "shows") that reads as a description of the app.
* Say what the change does for the reader, not a label for it. "The search
  field and its results are one surface" is unclear; "The search field and
  its results have been unified into a single surface" is clear.
* Keep each bullet focused on one change; combine details when they describe the same change.

### Examples

**Bad — too long and addresses the reader:**

> The index starts the moment you choose your Houdini in the setup, not when you leave that screen. The rest of the setup takes longer than the index, so the docs are ready by the time you reach the home page.

**Good — objective and concise:**

> Indexing now starts when the Houdini build is selected during onboarding.

**Bad — verbose and narrative:**

> A log of what the app did. It sits in `logs/` beside the index, it is written whether or not you send usage data, and it holds the launch, the install, the index pass, the server, the F1 hook, the update check and every error. The app name in the title bar has "Open logs". It goes when the app goes.

**Good — objective and descriptive:**

> App now creates local logs in `logs/` beside the index. Logs cover standard flows and errors, are not sent via telemetry, and are deleted on uninstall. The title bar also gets an "Open logs" button.

Do not include information that belongs in the README:

* What the product is or what it is for.
* Installation instructions or supported platforms.
* Features that are unchanged from previous versions.
* How the updater works.
* Where to report faults.
* Credits or licence information.

A reader should quickly be able to understand 
what is different in this version.

Every line must contribute directly to that answer.
Delete anything that does not.

## Signing

The private key lives in one offline backup and in the repo secret
`TAURI_SIGNING_PRIVATE_KEY`. It has no password, so the workflow sets
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to the empty string. Leaving it unset
makes the signer stop and ask on a terminal that is not there.

The public key is compiled into the app from `tauri.conf.json`. Changing it
breaks every installed copy.

## Building on this machine

    bun run tauri build

Run it from **Bash**, not PowerShell. `$env:NAME = ""` deletes the variable
rather than setting it empty, so the signer stops and asks for a password that
does not exist, and the build hangs after writing the bundle.

The bundler packs every `[[bin]]` of the crate into the installer. A tool that
users must not get, such as `probe`, is a cargo example.

## The installer

Per-user, `installMode: "currentUser"`. It installs to
`%LOCALAPPDATA%\<productName>` and asks for no administrator rights.

The folder, the uninstall entry and the shortcuts follow `productName`. A
build with a new name installs beside the old one, so `windows/hooks.nsh`
removes the install of the old name.

**Do not set `installMode` to `both` or `perMachine`.** Both make NSIS ask for
administrator rights, which means a UAC prompt on every install AND on every
silent update. Read the manifest to check a build:

    strings -a <installer>.exe | grep -o 'requestedExecutionLevel level="[a-z]*"'

`asInvoker` is right. `highestAvailable` is the broken one.

Data lives in `%APPDATA%\com.nodebookmd.app` and survives an uninstall, so a
reinstall does not index the docs again.

WebView2 comes from the downloading bootstrapper: the installer looks for the
runtime and fetches it only when the machine does not have it.

## The site still exists

The Next.js site lives on `web`, and releases from `web-prod`.
It will wind down on January 1st, 2027.

The Cloudflare app is installed on the repo, so a push to `web-prod` runs
`bun run deploy` in Cloudflare CI. **CI is the only place that deploys.** Never
run `bun run deploy` locally: Tailwind's native scanner ships one compiled
binary per operating system, so a local build makes a different CSS content
hash than CI, and that hash sits in the URL of every prerendered page.

Do not merge `main` into `web` or `web-prod`. They are two products now.

## Reading a build

A finished Cloudflare build reports status `stopped`, not `success`. Read the
log to tell a deploy from a failure — look for `Success: Deploy command
completed`, and check that `wrangler` printed a Version ID.
