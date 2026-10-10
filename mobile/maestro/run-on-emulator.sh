#!/usr/bin/env bash
# Runs the Maestro flows on the emulator Mobile CI has just booted (#267), against the end-to-end
# stack on the runner's localhost.
#
# A script rather than the emulator action's inline lines: each of those runs as a command of its
# own, which leaves no room for a loop. The emulator reports itself booted a little before adb can
# reach it -- "adb: device offline" -- so every step first waits for it, and the adb steps retry.
set -euo pipefail

apk="$1"

retry() {
  for attempt in 1 2 3 4 5; do
    "$@" && return 0
    echo "retrying ($attempt): $*" >&2
    sleep 5
  done
  return 1
}

adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
until adb shell pm path android >/dev/null 2>&1; do sleep 2; done

# The emulator's localhost is not the runner's: give it the stack's ports under the same numbers,
# so the app and Keycloak's issuer use the addresses the browser does.
retry adb reverse tcp:3000 tcp:3000
retry adb reverse tcp:8082 tcp:8082
retry adb install -r "$apk"

maestro test mobile/maestro --format junit --output maestro-report.xml --test-output-dir maestro-output

# Reminders (#273): turn them on, then make sure Android holds a pending alarm of the app's
# (`Alarm{... origWhen <ms> ... <package>}`) set for 08:00 in the emulator's own time zone -- not
# merely the package's name somewhere in the statistics. Any day's 08:00: which day "tomorrow" is
# was the emulator's to decide when the task was added, and a run may cross midnight.
maestro test mobile/maestro/reminders/turn-on.yaml --format junit --output maestro-reminders.xml --test-output-dir maestro-output
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

# Offline (#272): keep a board, take the backend away -- the app reaches it through adb reverse,
# which airplane mode does not cut -- and read the kept board.
maestro test mobile/maestro/offline/1-keep.yaml --format junit --output maestro-offline-1.xml --test-output-dir maestro-output
retry adb reverse --remove tcp:3000
maestro test mobile/maestro/offline/2-offline.yaml --format junit --output maestro-offline-2.xml --test-output-dir maestro-output
