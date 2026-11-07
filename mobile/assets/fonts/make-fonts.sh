#!/usr/bin/env bash
# Writes the app's fonts (#527), the faces hilling.it uses: Quicksand for the wordmark, Space
# Grotesk for headings, Inter Tight for text. Google Fonts publishes them only as variable fonts,
# whose weights React Native does not reliably pick on both platforms, so each weight the app uses
# is cut out as a static font of its own, cut down to Google's Latin subset; a character outside it
# falls back to the system's font. Each file's PostScript name is its file name, which is the name
# both iOS and Android know it by. Run it again from this directory to follow newer fonts; it needs
# fonttools (`pip install fonttools`).
set -euo pipefail
cd "$(dirname "$0")"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
latin='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
latin+='U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD'

# family directory, file stem, weights
cut() {
  local dir=$1 stem=$2 && shift 2
  curl -sfL -o "$work/$stem.ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/$dir/$stem%5Bwght%5D.ttf"
  curl -sfL -o "$stem-OFL.txt" "https://raw.githubusercontent.com/google/fonts/main/ofl/$dir/OFL.txt"
  for weight in "$@"; do
    local name
    case $weight in 400) name=Regular ;; 600) name=SemiBold ;; 700) name=Bold ;; esac
    fonttools varLib.instancer -q --update-name-table -o "$work/$stem-$name.ttf" "$work/$stem.ttf" "wght=$weight"
    pyftsubset "$work/$stem-$name.ttf" --unicodes="$latin" --layout-features='*' --output-file="$stem-$name.ttf"
  done
}

cut quicksand Quicksand 700
cut spacegrotesk SpaceGrotesk 700
cut intertight InterTight 400 600
