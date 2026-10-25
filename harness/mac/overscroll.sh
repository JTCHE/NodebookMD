#!/bin/bash
# A pull past the top of the window, as a trackpad makes it, must not move
# the window's content: the title bar and the panel stay still (the root
# `overscroll-behavior` in globals.css). Run on the macos-check runner:
#   gh workflow run macos-check.yml -f run="bash harness/mac/overscroll.sh"
# The window is filmed still, then in the middle of the pull, which is held
# open until the picture is taken. The two must match.
set -euo pipefail
out=${OUT:-out}
mkdir -p "$out"

cat > /tmp/pull.swift <<'SWIFT'
import CoreGraphics
import Foundation
let point = CGPoint(x: Double(CommandLine.arguments[1])!, y: Double(CommandLine.arguments[2])!)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(300_000)
// A trackpad's scroll: continuous, in pixels, with a phase. Began, then
// changed, and ended only after the picture is taken.
func scroll(_ dy: Int32, _ phase: Int64) {
    let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: dy, wheel2: 0, wheel3: 0)!
    event.setIntegerValueField(.scrollWheelEventIsContinuous, value: 1)
    event.setIntegerValueField(.scrollWheelEventScrollPhase, value: phase)
    event.location = point
    event.post(tap: .cghidEventTap)
    usleep(16_000)
}
scroll(4, 1)
for _ in 0..<40 { scroll(12, 2) }
FileManager.default.createFile(atPath: "/tmp/held", contents: nil)
usleep(3_000_000)
scroll(0, 4)
SWIFT
swiftc -O /tmp/pull.swift -o /tmp/pull

./src-tauri/target/debug/nodebookmd > "$out/stdout.log" 2>&1 &
app=$!
trap 'kill $app 2>/dev/null || true' EXIT
sleep 25

events() { osascript -e "tell application \"System Events\" to $1"; }
events 'set frontmost of process "nodebookmd" to true'
sleep 1
read -r x y w h < <(events 'tell window 1 of process "nodebookmd" to get {position, size}' | tr -d ',')
shot() { screencapture -x -R "$x,$y,$w,$h" "$out/$1.png"; sips -s format bmp "$out/$1.png" --out "/tmp/$1.bmp" > /dev/null; }

shot still
/tmp/pull $((x + w / 2)) $((y + h / 2)) > /dev/null &
pull=$!
until [ -e /tmp/held ]; do sleep 0.05; done
shot pulled
wait $pull

node harness/mac/same.mjs /tmp/still.bmp /tmp/pulled.bmp || { echo "FAIL: the window moved during a pull past the top"; exit 1; }
echo "PASS: the window stays still during a pull past the top"
