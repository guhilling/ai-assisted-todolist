#!/usr/bin/env bash
# Renders the app's icons from their SVG sources in icons/, which doc/images/generate.py writes
# from the one drawing of the mark. Expo takes PNGs only. Run it after generate.py whenever the
# mark changes; it needs rsvg-convert (macOS: brew install librsvg).
set -euo pipefail
cd "$(dirname "$0")"

rsvg-convert -w 1024 -h 1024 -o icon.png icons/icon.svg
rsvg-convert -w 512 -h 512 -o android-icon-foreground.png icons/android-icon-foreground.svg
rsvg-convert -w 512 -h 512 -o android-icon-background.png icons/android-icon-background.svg
rsvg-convert -w 432 -h 432 -o android-icon-monochrome.png icons/android-icon-monochrome.svg
rsvg-convert -w 96 -h 96 -o notification-icon.png icons/notification-icon.svg
