# NodebookMD

![The NodebookMD home page, with the app open on a sample page](public/cover.png)

<p align="center"><b>Fast docs for SideFX Houdini.</b> Formerly HoudiniMD.<br><br>A free desktop app that reads the documentation of the Houdini you have installed.<br>Search it, browse it, and open it from Houdini with <kbd>F1</kbd>, in a fraction of a second.</p>

<div align="center">
  <a target="_blank" href="https://nodebook.md/download"><img src="public/badges/download.svg" height="42" alt="Download for Windows"></a>
  <a target="_blank" href="https://nodebook.md"><img src="public/badges/website.svg" height="42" alt="Open NodebookMD"></a>
  <a target="_blank" href="https://github.com/JTCHE/houdini-mcp"><img src="public/badges/mcp.svg" height="42" alt="Houdini MCP"></a>
  <a target="_blank" href="https://github.com/sponsors/JTCHE?frequency=one-time"><img src="public/badges/sponsor.svg" height="42" alt="Sponsor on GitHub"></a>
</div>
<br>

## Why

Houdini's help is thorough, but not the handiest to navigate through. Each query waits on a sluggish local help server, and a search means a trip to the browser.

NodebookMD reads the same pages from your install, indexes them once, and displays them in a clean, fast interface. It's completely offline, making it faster and more secure.

![The NodebookMD sidebar, showcasing a version switcher and collapsed categories](public/NodebookMD_Sidebar_Closeup.png)

## Features

- **Instant search:** <kbd>Ctrl</kbd> <kbd>K</kbd> finds any node, VEX function or HOM class as you type. Paste a sidefx.com link and it opens that page.
- **Bookmarks and history:** <kbd>Ctrl</kbd> <kbd>D</kbd> keeps a page. Recent pages are one click away.
- **Native Houdini Integration:** Set NodebookMD as the help server of an install. <kbd>F1</kbd> or **Get Help** on a node then opens its page in Houdini's help pane.
- **Your build, offline:** The docs come from the Houdini on your disk. Switch between versions from the sidebar.
- **Copy as Markdown:** <kbd>Ctrl</kbd> <kbd>C</kbd> copies the whole page as clean Markdown, ready for notes or a prompt.
- **Built for agents:** The [Houdini MCP](https://github.com/JTCHE/houdini-mcp) gives Claude, Codex, Gemini and other agents the same docs, for the exact build you use, next to the tools that drive Houdini.
- **Light, dark and system** themes, that can be changed at any time in the sidebar or in Settings

## Speed

NodebookMD opens a readable page 19 times faster than Houdini's own help server.

<img src="public/help-server-benchmark.png" alt="A bar chart of the time from F1 to a readable page in Houdini's help pane, for Houdini's own help server and for NodebookMD. NodebookMD is 19.3 times faster at the median.">

## Install

### Windows

[**Download for Windows**](https://nodebook.md/download), run the installer, and choose your Houdini install. The app updates itself.

> [!NOTE]
> The installer is not signed yet, so Windows shows "Windows protected your PC". Select **More info**, then **Run anyway**.

### macOS

[**Download for macOS**](https://nodebook.md/download/macos), for Apple Silicon. Open the disk image and drag NodebookMD to Applications. The app updates itself.

> [!NOTE]
> The app is not notarized yet, so macOS stops it the first time. Open System Settings, then Privacy & Security, and select **Open Anyway**. To skip that step, install it from Terminal instead:
>
> ```sh
> curl -fsSL https://nodebook.md/install.sh | sh
> ```

### Linux

[**Download the AppImage**](https://nodebook.md/download/linux), then:

```sh
chmod +x NodebookMD.AppImage
./NodebookMD.AppImage
```

It carries its own WebKitGTK, so it needs no packages. It runs on glibc 2.34 and later: Ubuntu 22.04 and 24.04, RHEL 9, Rocky 9 and AlmaLinux 9.

> [!WARNING]
> On Ubuntu 26.04 the app closes at start, from a WebKit fault with the newest Mesa. This is a known issue.

### Build Instructions

You need [Bun](https://bun.sh), [Rust](https://rustup.rs) and, on a Debian or Ubuntu base:

```sh
sudo apt install build-essential curl wget file pkg-config libssl-dev python3 \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
  patchelf xdg-utils desktop-file-utils
```

```sh
bun install
bun run tauri build --bundles appimage
```

The file lands in `src-tauri/target/release/bundle/appimage/` and runs on the distro that built it. To also reach RHEL 9, run the widen pass over the packed folder:

```sh
cd src-tauri/target/release/bundle/appimage
OUTPUT=$PWD/NodebookMD.AppImage bash ../../../../linux/widen.sh NodebookMD.AppDir
```

The release workflow does all of this: [.github/workflows/release.yml](.github/workflows/release.yml).

## Pricing

Free, with no account. The docs belong to SideFX, and reading them will never cost anything.

Paid features will come later, for people who want more: notes on a page, and settings and bookmarks synced across machines.

## Credits and license

Built by [John C](https://jchd.me). The code is released under the [MIT License](LICENSE).

NodebookMD is an unofficial, independent project. It is not affiliated with or endorsed by SideFX. Houdini is a trademark of SideFX.
