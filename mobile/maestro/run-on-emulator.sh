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

# Reminders (#273): turn them on, then make sure Android holds the app's alarm for tomorrow 08:00 --
# a pending alarm (`Alarm{... <package>}`) set for that moment, in the emulator's own time zone, not
# merely the package's name somewhere in the statistics.
maestro test mobile/maestro/reminders/turn-on.yaml --format junit --output maestro-reminders.xml --test-output-dir maestro-output
zone="$(adb shell getprop persist.sys.timezone | tr -d '\r')"
expected="$(TZ="${zone:-UTC}" date -d 'tomorrow 08:00' +%s)000"
# Read once, for the check and for saying what was found instead.
alarms="$(adb shell dumpsys alarm)"
if ! grep -E "Alarm\{.*origWhen ${expected}.*de\.hilling\.taskfest\.dev\}" <<< "$alarms"; then
  echo "No reminder is scheduled for ${expected} (tomorrow 08:00 in ${zone:-UTC}). The app's alarms:" >&2
  grep -n -A2 "de.hilling.taskfest.dev" <<< "$alarms" | head -40 >&2 || true
  exit 1
fi

# Offline (#272): keep a board, take the backend away -- the app reaches it through adb reverse,
# which airplane mode does not cut -- and read the kept board.
maestro test mobile/maestro/offline/1-keep.yaml --format junit --output maestro-offline-1.xml --test-output-dir maestro-output
retry adb reverse --remove tcp:3000
maestro test mobile/maestro/offline/2-offline.yaml --format junit --output maestro-offline-2.xml --test-output-dir maestro-output
