#!/bin/bash
# ⌘0 resets the zoom on a French keyboard, where the 0 key types "à" with no
# Shift (src/lib/ui/zoom.ts). Run on the macos-check runner:
#   gh workflow run macos-check.yml -f run="bash harness/mac/zoom-french.sh"
# The app window is filmed before, zoomed, and after ⌘0. The last picture
# must match the first.
set -euo pipefail
out=${OUT:-out}
mkdir -p "$out"

cat > /tmp/layout.swift <<'SWIFT'
import Carbon
let filter = [kTISPropertyInputSourceID as String: CommandLine.arguments[1]] as CFDictionary
guard let found = TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource],
      let layout = found.first else { print("no such layout"); exit(1) }
TISEnableInputSource(layout)
exit(TISSelectInputSource(layout) == noErr ? 0 : 1)
SWIFT
swift /tmp/layout.swift com.apple.keylayout.French
defaults read com.apple.HIToolbox AppleSelectedInputSources | tee "$out/layout.txt"

./src-tauri/target/debug/houdinimd > "$out/stdout.log" 2>&1 &
app=$!
trap 'kill $app 2>/dev/null || true' EXIT
sleep 25

events() { osascript -e "tell application \"System Events\" to $1"; }
events 'set frontmost of process "houdinimd" to true'
sleep 1
read -r x y w h < <(events 'tell window 1 of process "houdinimd" to get {position, size}' | tr -d ',' )
shot() { sleep 1.5; screencapture -x -R "$x,$y,$w,$h" "$out/$1.png"; sips -s format bmp "$out/$1.png" --out "/tmp/$1.bmp" > /dev/null; }

shot before
# Key code 24 types "-" on the French layout: ⌘- zooms out. 29 is the 0 key.
events 'key code 24 using command down'
events 'key code 24 using command down'
shot zoomed
events 'key code 29 using command down'
shot after

same() { node harness/mac/same.mjs "/tmp/$1.bmp" "/tmp/$2.bmp"; }
same before zoomed && { echo "FAIL: ⌘- did not zoom, so the keys did not reach the app"; exit 1; }
same before after || { echo "FAIL: ⌘0 on the French layout did not reset the zoom"; exit 1; }
echo "PASS: ⌘0 resets the zoom on the French layout"
