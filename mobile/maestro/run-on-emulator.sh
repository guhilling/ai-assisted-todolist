#!/usr/bin/env bash
# Runs one share of the Maestro flows on the emulator Mobile CI has just booted (#267), against the
# end-to-end stack on the runner's localhost. Mobile CI runs both shares at once, each on an
# emulator and a stack of its own, so neither flow sees the other's changes:
#
#   board   signing in, changing the board, and sharing into the app -- the longest flow
#   others  the account sheet, the reminders, and the board read offline
#
# A script rather than the emulator action's inline lines: each of those runs as a command of its
# own, which leaves no room for a loop. emulator-ready.sh waits for the emulator and sets its clock.
set -euo pipefail

apk="$1"
share="$2"
here="$(dirname "$0")"

source "$here/emulator-ready.sh"

# `maestro test` for the given flows, its JUnit report going to the first argument, run once more
# when Maestro's own driver failed before the flow began (#445), as the iOS share flow is (#401):
# driver-failed.sh says which. The first run's console output and report stay in the artifact.
flows() {
  local report="$1" console run
  shift
  mkdir -p maestro-output
  for run in 1 2; do
    console="maestro-output/$(basename "$report" .xml)-$run-console.txt"
    if maestro test "$@" --format junit --output "$report" --test-output-dir maestro-output 2>&1 | tee "$console"; then
      return 0
    fi
    if (( run == 2 )) || ! bash "$here/driver-failed.sh" "$console" "$report"; then
      return 1
    fi
    cp "$report" "maestro-output/$(basename "$report" .xml)-1.xml" 2>/dev/null || true
    echo "::warning title=Maestro's driver failed::$* is run once more (#445)."
  done
}

# Awake and unlocked, however long seed-stack.sh waited for midnight to pass.
retry adb shell svc power stayon true
retry adb shell input keyevent KEYCODE_WAKEUP
retry adb shell wm dismiss-keyguard

# Three-button navigation rather than gestures: the share sheet opens with its first row of apps at
# the very bottom of the screen, where a tap on Create Task (Dev) was now and then taken for the
# start of a gesture, and the sheet went away without sharing (#407). With buttons it ends above them.
# Waited for until the system says it navigates with buttons (mode 0), not only that the switch is on.
retry adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton
for attempt in $(seq 30); do
  mode="$(adb shell settings get secure navigation_mode 2>/dev/null | tr -d '\r')" || true
  [[ "$mode" == 0 ]] && break
  sleep 1
done
if [[ "$mode" != 0 ]]; then
  echo "Android still navigates with gestures (navigation_mode ${mode:-unknown}), not three buttons." >&2
  exit 1
fi

# The emulator's localhost is not the runner's: give it the stack's ports under the same numbers,
# so the app and Keycloak's issuer use the addresses the browser does -- and storage's, which the
# backend signs links to as s3.localhost:4566 (#274); Android resolves *.localhost to itself.
retry adb reverse tcp:3000 tcp:3000
retry adb reverse tcp:8082 tcp:8082
retry adb reverse tcp:4566 tcp:4566
retry adb install -r "$apk"

case "$share" in
  board)
    flows maestro-report.xml mobile/maestro/sign-in.yaml mobile/maestro/change-tasks.yaml
    # Adding with the keyboard open (#382), still signed in.
    flows maestro-keyboard.xml mobile/maestro/keyboard.yaml
    # Sharing into the app (#355), which the board flow left signed in: text sent as another app
    # sends it -- the inner quotes keep it one argument in the emulator's shell -- and then an image
    # through the Files app's share sheet.
    adb shell am start -a android.intent.action.SEND -t text/plain -p de.hilling.taskfest.dev \
      --es android.intent.extra.TEXT "'Read the article https://example.com/a'"
    flows maestro-share-text.xml mobile/maestro/share/text.yaml
    retry bash "$here/put-attach-image.sh"
    flows maestro-share-sheet.xml mobile/maestro/share/share-sheet.yaml
    # A link, as Chrome shares a page (#414): the address as the text, the title as the subject. Last,
    # as its task would push the others' below the screen, where their flows look for them.
    adb shell am start -a android.intent.action.SEND -t text/plain -p de.hilling.taskfest.dev \
      --es android.intent.extra.TEXT "'https://example.com/articles/42'" \
      --es android.intent.extra.SUBJECT "'An article worth reading'"
    flows maestro-share-link.xml mobile/maestro/share/link.yaml
    exit 0
    ;;
  others) ;;
  *)
    echo "Unknown share of the flows: '${share}' (board or others)" >&2
    exit 2
    ;;
esac

flows maestro-report.xml mobile/maestro/account.yaml

# Reminders (#273): turn them on, then make sure Android holds a pending alarm of the app's
# (`Alarm{... origWhen <ms> ... <package>}`) set for 08:00 in the emulator's own time zone -- not
# merely the package's name somewhere in the statistics. Any day's 08:00: which day "tomorrow" is
# was the emulator's to decide when the task was added, and a run may cross midnight.
flows maestro-reminders.xml mobile/maestro/reminders/turn-on.yaml
zone="$(adb shell getprop persist.sys.timezone | tr -d '\r')"
alarms="$(adb shell dumpsys alarm)"
scheduled=false
for when in $(grep -oE 'Alarm\{[^}]*origWhen [0-9]+[^}]*de\.hilling\.taskfest\.dev\}' <<< "$alarms" |
  grep -oE 'origWhen [0-9]+' | awk '{ print $2 }'); do
  at="$(TZ="${zone:-UTC}" date -d "@$((when / 1000))" '+%F %H:%M')"
  echo "The app has an alarm at ${at} (${zone:-UTC})."
  if [[ "$at" == *" 08:00" ]]; then
    scheduled=true
  fi
done
if [[ "$scheduled" != true ]]; then
  echo "No reminder is scheduled for 08:00 in ${zone:-UTC}. The app's entries in dumpsys alarm:" >&2
  grep -n -A2 "de.hilling.taskfest.dev" <<< "$alarms" | head -40 >&2 || true
  exit 1
fi

# Attaching (#274): an image in the emulator's Downloads, for the file picker to offer.
retry bash "$here/put-attach-image.sh"
flows maestro-attach.xml mobile/maestro/attach.yaml

# Offline (#272): keep a board, take the backend away -- the app reaches it through adb reverse,
# which airplane mode does not cut -- and read the kept board.
flows maestro-offline-1.xml mobile/maestro/offline/1-keep.yaml
retry adb reverse --remove tcp:3000
flows maestro-offline-2.xml mobile/maestro/offline/2-offline.yaml
