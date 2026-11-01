#!/usr/bin/env bash
# Shares into the iOS app through the real share sheet (#380): boots an iPhone simulator, installs
# the simulator build Mobile CI's ios job made and signed, and runs the flows in this folder: one of
# the photos every simulator comes with, shared from Photos, and a page shared from Safari.
# Usage: run-on-simulator.sh <path to .app>
set -euo pipefail

app=$1
here=$(cd "$(dirname "$0")" && pwd)
out=${MAESTRO_OUTPUT:-maestro-output-ios}
mkdir -p "$out"

# The first iPhone of the newest iOS runtime, by its version's numbers: as text, iOS-26-2 would come
# after iOS-26-10.
udid=$(xcrun simctl list devices available -j | python3 -c '
import json, re, sys
devices = json.load(sys.stdin)["devices"]
def version(runtime):
    return tuple(int(n) for n in re.findall(r"\d+", runtime.rsplit("iOS", 1)[-1]))
ios = sorted((r for r in devices if ".iOS-" in r), key=version, reverse=True)
print(next(d["udid"] for r in ios for d in devices[r] if d["name"].startswith("iPhone")))')
# Boots it, if need be, and waits until it has.
xcrun simctl bootstatus "$udid" -b
xcrun simctl install "$udid" "$app"

status=0
for flow in share-photo share-link; do
  started=$(date -u +%s)
  # Run once more when Maestro's own driver failed rather than the flow (#401); driver-failed.sh
  # says which. Each run keeps its own console output and debug output in the artifact.
  for run in 1 2; do
    # Each share finds the app closed, as after a restart: the extension has to open it. Photos and
    # Safari are closed too, so a share left half done cannot carry over into the next flow.
    for bundle in de.hilling.taskfest.dev com.apple.mobileslideshow com.apple.mobilesafari; do
      xcrun simctl terminate "$udid" "$bundle" 2>/dev/null || true
    done
    flow_status=0
    # What is newer than this is the run's own: the XCTest runner's log, which driver-failed.sh
    # reads too (#473), lands in a folder of the run's start time.
    started_run=$(mktemp)
    # Maestro's debug output -- its screenshots and every command -- goes into the artifact too, so
    # a failed share shows what the simulator did (#401).
    maestro --device "$udid" test "$here/$flow.yaml" --test-output-dir "$out" --debug-output "$out/debug-$flow-$run" \
      --format junit --output "maestro-ios-$flow.xml" 2>&1 | tee "$out/$flow-$run-console.txt" || flow_status=1
    runner_logs=()
    while IFS= read -r log; do runner_logs+=("$log"); done \
      < <(find "$out" -name 'xctest_runner_*.log' -newer "$started_run")
    rm -f "$started_run"
    if (( flow_status == 0 )) || (( run == 2 )) ||
       ! bash "$here/../driver-failed.sh" "$out/$flow-$run-console.txt" "maestro-ios-$flow.xml" \
         ${runner_logs[@]+"${runner_logs[@]}"}; then
      break
    fi
    echo "::warning title=Maestro's driver failed::$flow is run once more (#401)."
  done
  (( flow_status == 0 )) || status=1
  # How the simulator ended, and its log for the share: Photos or Safari, the share sheet, the
  # extension and the app it opens.
  xcrun simctl io "$udid" screenshot "$out/$flow-end.png" || true
  xcrun simctl spawn "$udid" log show --style compact --info --debug \
    --start "$(date -u -r "$started" '+%Y-%m-%d %H:%M:%S')" \
    --predicate 'process CONTAINS[c] "taskfest" OR process CONTAINS[c] "expo-sharing" OR process == "sharingd" OR process == "MobileSlideShow" OR process == "MobileSafari" OR process == "SpringBoard" OR process == "runningboardd"' \
    >"$out/$flow-simulator.log" 2>&1 || true
done
exit $status
