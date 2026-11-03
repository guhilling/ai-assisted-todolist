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
# A process's first start on the fresh simulator may take over a minute, the app's once did (#500):
# the app is started and stopped once here, so that cost is paid before a flow waits for it. Photos
# is opened once too, until its grid is up; if it does not get there, the shares still run.
xcrun simctl launch "$udid" de.hilling.taskfest.dev ||
  echo "::warning title=App not warmed up::the shares run anyway (#500)."
xcrun simctl terminate "$udid" de.hilling.taskfest.dev || true
maestro --device "$udid" test "$here/warm-up-photos.yaml" --test-output-dir "$out" \
  --debug-output "$out/debug-warm-up-photos" 2>&1 | tee "$out/warm-up-photos-console.txt" ||
  echo "::warning title=Photos not warmed up::the shares run anyway (#500)."

# Photos is logged by its daemons and subsystems as well as its process, whose name matched no line
# of the log (#500); sharinguiservice draws Safari's share sheet.
log_predicate='process CONTAINS[c] "taskfest" OR process CONTAINS[c] "expo-sharing"'
log_predicate+=' OR process == "sharingd" OR process == "sharinguiservice"'
log_predicate+=' OR process CONTAINS[c] "slideshow" OR process CONTAINS[c] "photos"'
log_predicate+=' OR process == "assetsd" OR process == "photolibraryd"'
log_predicate+=' OR subsystem BEGINSWITH "com.apple.photos"'
log_predicate+=' OR process == "MobileSafari" OR process == "SpringBoard"'
log_predicate+=' OR process == "runningboardd"'

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
    # What is newer than this is the run's own: Maestro's log and the XCTest runner's, which
    # driver-failed.sh reads too (#473), land in a folder of the run's start time.
    started_run=$(mktemp)
    # Maestro's debug output -- its screenshots and every command -- goes into the artifact too, so
    # a failed share shows what the simulator did (#401).
    maestro --device "$udid" test "$here/$flow.yaml" --test-output-dir "$out" --debug-output "$out/debug-$flow-$run" \
      --format junit --output "maestro-ios-$flow.xml" 2>&1 | tee "$out/$flow-$run-console.txt" || flow_status=1
    runner_logs=()
    while IFS= read -r log; do runner_logs+=("$log"); done \
      < <(find "$out" \( -name 'xctest_runner_*.log' -o -name maestro.log \) -newer "$started_run")
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
    --predicate "$log_predicate" \
    >"$out/$flow-simulator.log" 2>&1 || true
done
exit $status
