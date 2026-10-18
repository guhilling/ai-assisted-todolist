#!/usr/bin/env bash
# SPIKE #279: shares into the app on the emulator, each step on its own so one failing tells the rest.
# Run by run-on-emulator.sh's board share, after the board flow left the app signed in.
set -uo pipefail
app=de.hilling.taskfest.dev
out=maestro-output/spike
mkdir -p "$out"
step() {  # step <name> <flow>
  if maestro test "$2" --test-output-dir "$out" > "$out/$1.log" 2>&1; then echo "SPIKE $1: passed"; else echo "SPIKE $1: FAILED"; tail -n 25 "$out/$1.log"; fi
}
adb logcat -c

echo "== text, app open"
adb shell am start -a android.intent.action.SEND -t text/plain -p "$app" \
  --es android.intent.extra.TEXT "'Read the article https://example.com/a'"
step text mobile/maestro/spike/text.yaml

echo "== image, app open, from the media store"
bash "$(dirname "$0")/../put-attach-image.sh"
adb shell content query --uri content://media/external/images/media --projection _id:_display_name | tee "$out/images.txt"
image_id=$(grep -o '_id=[0-9]*, _display_name=attach-me.png' "$out/images.txt" | head -1 | sed 's/_id=\([0-9]*\),.*/\1/')
adb shell am start -a android.intent.action.SEND -t image/png -p "$app" --grant-read-uri-permission \
  --eu android.intent.extra.STREAM "content://media/external/images/media/$image_id"
step image mobile/maestro/spike/image.yaml

echo "== PDF, app not running"
pdf="$(mktemp -d)/share-me.pdf"
printf '%s\n' '%PDF-1.4' '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj' '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj' \
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj' 'trailer<</Root 1 0 R>>' '%%EOF' > "$pdf"
adb push "$pdf" /sdcard/Download/share-me.pdf
adb shell content call --uri content://media --method scan_volume --arg external_primary > /dev/null || true
adb shell content query --uri content://media/external/file --projection _id:_display_name:mime_type | grep -i "share-me" | tee "$out/files.txt"
pdf_id=$(grep -o '_id=[0-9]*' "$out/files.txt" | head -1 | cut -d= -f2)
adb shell am force-stop "$app"
adb shell am start -a android.intent.action.SEND -t application/pdf -p "$app" --grant-read-uri-permission \
  --eu android.intent.extra.STREAM "content://media/external/file/$pdf_id"
step pdf-cold mobile/maestro/spike/pdf-cold.yaml

echo "== the share sheet"
step share-sheet mobile/maestro/spike/share-sheet.yaml

adb logcat -d -s ReactNativeJS:V > "$out/logcat-js.txt"
grep '\[share\]' "$out/logcat-js.txt" || echo "No [share] lines in the JS log."
adb shell dumpsys package "$app" | grep -A3 -i "android.intent.action.SEND" > "$out/intent-filters.txt" || true
cat "$out/intent-filters.txt"
