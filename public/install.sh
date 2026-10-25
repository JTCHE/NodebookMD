#!/bin/sh
# Installs NodebookMD on a Mac with Apple Silicon:
#
#   curl -fsSL https://nodebook.md/install.sh | sh
#
# It takes the app the updater takes, from the latest GitHub release. macOS
# marks a file from a browser as downloaded and asks for "Open Anyway" once;
# a file from curl has no such mark, so the app opens at once. After this, the
# app updates itself.
set -eu

REPO=https://github.com/JTCHE/NodebookMD
APP=NodebookMD.app

fail() {
  printf 'NodebookMD: %s\n' "$1" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "this script is for macOS. For Windows and Linux, go to https://nodebook.md"
[ "$(uname -m)" = arm64 ] || fail "the macOS app needs Apple Silicon (M1 or later)."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "$REPO/releases/latest/download/latest.json" -o "$tmp/latest.json" || fail "could not reach GitHub."
url=$(plutil -extract platforms.darwin-aarch64.url raw -o - "$tmp/latest.json" 2>/dev/null) ||
  fail "the latest release has no macOS build yet."

echo "Downloading $(plutil -extract version raw -o - "$tmp/latest.json")..."
curl -fL --progress-bar "$url" -o "$tmp/app.tar.gz" || fail "the download failed."
tar -xzf "$tmp/app.tar.gz" -C "$tmp"
[ -d "$tmp/$APP" ] || fail "the download holds no $APP."

# /Applications when this account may write there (an admin account may),
# else the account's own Applications folder.
dest=/Applications
[ -w "$dest" ] || { dest=$HOME/Applications; mkdir -p "$dest"; }

if [ -d "$dest/$APP" ]; then
  # Quit it first, then move the old copy to the Bin, where it can come back.
  # A Terminal without Full Disk Access may not write to the Bin; then the old
  # copy goes with the download.
  # Before 0.3.0 the app's id was com.houdinimd.app.
  for id in com.nodebookmd.app com.houdinimd.app; do
    osascript -e "tell application id \"$id\" to quit" >/dev/null 2>&1 || true
  done
  sleep 1
  mv "$dest/$APP" "$HOME/.Trash/$APP $(date +%Y%m%d-%H%M%S)" 2>/dev/null || mv "$dest/$APP" "$tmp/old.app"
fi

ditto "$tmp/$APP" "$dest/$APP"
# The release has no mark, but a copy made from a browser download would carry
# it into the archive.
xattr -dr com.apple.quarantine "$dest/$APP" 2>/dev/null || true
echo "Installed in $dest. Opening NodebookMD..."
open "$dest/$APP"
