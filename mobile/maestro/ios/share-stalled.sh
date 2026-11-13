#!/usr/bin/env bash
# Says whether the iOS photo share failed because the simulator's Photos stalled before TaskFest's
# extension started, not because of TaskFest: exits 0 when Maestro's console output says the flow
# failed on Photos still "Preparing...", 1 otherwise (#533).
#
#   share-stalled.sh CONSOLE
#
# Photos now and then never finishes preparing the photo, so iOS never starts the extension;
# share-photo.yaml restarts Photos and shares again once, and on main that second share stalled as
# well, twice in a day. The flow then fails on an assertion of its own -- "Preparing" still on the
# screen -- which only Photos shows, never TaskFest's extension. Only the flow's final failure counts,
# its "[Failed]" line, so a step that failed earlier and was allowed to does not. run-on-simulator.sh
# runs the flow once more after it, as after a failure of Maestro's own driver (driver-failed.sh).
# TaskFest Dev missing from the sheet, the extension never opening the app, and anything else
# still fail at once.
set -uo pipefail

console=${1:?"usage: share-stalled.sh CONSOLE"}
[[ -r "$console" ]] || exit 1

grep -qE '^\[Failed\] Share a photo .*"Preparing' "$console"
