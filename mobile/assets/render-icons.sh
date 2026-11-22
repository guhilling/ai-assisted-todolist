#!/usr/bin/env bash
# Renders the app's icons and Play's listing graphics from their SVG sources in icons/, which
# doc/images/generate.py writes from the one drawing of the mark: Expo and Play take PNGs. Run it
# after generate.py whenever the mark changes; it needs rsvg-convert and ffmpeg (macOS: brew install librsvg ffmpeg).
set -euo pipefail
cd "$(dirname "$0")"

rsvg-convert -w 1024 -h 1024 -o icon.png icons/icon.svg
rsvg-convert -w 512 -h 512 -o android-icon-foreground.png icons/android-icon-foreground.svg
rsvg-convert -w 512 -h 512 -o android-icon-background.png icons/android-icon-background.svg
rsvg-convert -w 432 -h 432 -o android-icon-monochrome.png icons/android-icon-monochrome.svg
rsvg-convert -w 96 -h 96 -o notification-icon.png icons/notification-icon.svg

# Play's listing (doc/mobile/public-release.md), uploaded by hand: the icon with an alpha channel and
# the graphic without one, as Play asks, whatever rsvg-convert makes of the drawing. setsar, because
# ffmpeg otherwise writes pixels of no width.
mkdir -p store
png() { ffmpeg -loglevel error -y -f png_pipe -i - -vf setsar=1 -pix_fmt "$1" "$2"; }
rsvg-convert -w 512 -h 512 icons/icon.svg | png rgba store/play-icon.png
rsvg-convert -w 1024 -h 500 icons/feature-graphic.svg | png rgb24 store/feature-graphic.png
