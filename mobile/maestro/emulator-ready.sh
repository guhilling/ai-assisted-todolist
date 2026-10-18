#!/usr/bin/env bash
# Waits until the emulator Mobile CI or the live run has just booted can be used, and sets its clock
# (#267, #278). Sourced by run-on-emulator.sh and live/run-on-qa.sh, after `set -euo pipefail`; it
# leaves `retry` behind for them.
#
# The emulator reports itself booted a little before adb can reach it -- "adb: device offline" --
# so every step first waits for it, and the adb steps retry.

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

# An emulator woken from main's snapshot (#302) may still keep the day it was saved, and the flows
# depend on today: the seeded task is due today, a new one tomorrow. Set its clock from the runner's
# when they differ by more than half a minute; google_apis images let adb be root for that.
drift=$(( $(date +%s) - $(adb shell date +%s | tr -d '\r') ))
echo "The emulator's clock is ${drift} s behind the runner's."
if (( drift > 30 || drift < -30 )); then
  retry adb root
  adb wait-for-device
  retry adb shell date "@$(date +%s)"
  adb unroot || true
  adb wait-for-device
fi

