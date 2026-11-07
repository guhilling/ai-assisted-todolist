#!/usr/bin/env bash
# Writes the app's fonts (#527), the faces hilling.it uses: Quicksand for the wordmark, Space
# Grotesk for headings, Inter Tight for text. Each file's PostScript name is its file name, which
# is the name both iOS and Android know it by, and each keeps its copyright and its licence, the
# SIL Open Font License, in its own metadata, as that licence allows.
#
# Quicksand Bold is its authors' own static font, unchanged: its licence reserves the name
# "Quicksand", which a modified font may not carry. Space Grotesk and Inter Tight reserve no name.
# Google Fonts publishes them only as variable fonts, whose weights React Native does not reliably
# pick on both platforms, so each weight the app uses is cut out as a static font of its own, cut
# down to Google's Latin subset; a character outside it falls back to the system's font.
#
# The sources are pinned to the commits below, and the cut files are dated google/fonts' commit
# time, so running it again writes the same bytes; to follow newer fonts, move them. Every file is
# made first and moved here only when all are, so a failed run changes nothing. It needs fonttools
# (`pip install fonttools`).
set -euo pipefail
cd "$(dirname "$0")"

google_fonts=86aced91de05cd4f96a06838124cca45be337b2b
quicksand=be4b9d638e1c79fa42d4a0ab0aa7fe29466419c7
export SOURCE_DATE_EPOCH=1793978327
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/out"
latin='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,'
latin+='U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD'

# family directory, file stem, weights
cut_font() {
  local dir=$1 stem=$2 && shift 2
  local source="https://raw.githubusercontent.com/google/fonts/$google_fonts/ofl/$dir"
  curl -sfL -o "$work/$stem.ttf" "$source/$stem%5Bwght%5D.ttf"
  curl -sfL -o "$work/out/$stem-OFL.txt" "$source/OFL.txt"
  for weight in "$@"; do
    local name
    case $weight in
      400) name=Regular ;;
      600) name=SemiBold ;;
      700) name=Bold ;;
      *) echo "make-fonts.sh: no name for weight $weight" >&2 && exit 1 ;;
    esac
    fonttools varLib.instancer -q --update-name-table -o "$work/$stem-$name.ttf" "$work/$stem.ttf" \
      "wght=$weight"
    pyftsubset "$work/$stem-$name.ttf" --unicodes="$latin" --layout-features='*' --name-IDs='*' \
      --output-file="$work/out/$stem-$name.ttf"
  done
}

upstream="https://raw.githubusercontent.com/andrew-paglinawan/QuicksandFamily/$quicksand"
curl -sfL -o "$work/out/Quicksand-Bold.ttf" "$upstream/fonts/statics/Quicksand-Bold.ttf"
curl -sfL -o "$work/out/Quicksand-OFL.txt" "$upstream/OFL.txt"
cut_font spacegrotesk SpaceGrotesk 700
cut_font intertight InterTight 400 600
mv "$work"/out/* .
