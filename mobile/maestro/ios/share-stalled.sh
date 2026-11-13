#!/usr/bin/env bash
# Says whether an iOS share failed because the simulator's own iOS stalled before TaskFest's code
# ran, not because of TaskFest: exits 0 when Maestro's console output names one of the two stalls,
# 1 otherwise (#533).
#
#   share-stalled.sh CONSOLE
#
# Photos now and then never finishes "Preparing..." the photo, so iOS never starts the extension;
# share-photo.yaml restarts Photos and shares again once, and on main that second share stalled as
# well, twice in a day. Safari's menu now and then never opens, so its Share is not found. Both
# come before the share sheet has offered TaskFest Dev, so a run after them tells as much as the
# first would have. run-on-simulator.sh runs the flow once more after these, as after a failure of
# Maestro's own driver (driver-failed.sh). TaskFest Dev missing from the sheet, the app not starting
# after the share, and anything else still fail at once.
set -uo pipefail

console=${1:?"usage: share-stalled.sh CONSOLE"}
[[ -r "$console" ]] || exit 1

# Fixed strings, as Maestro reports the failing step.
photos_stuck='Assertion is false: "(Open in .TaskFest Dev.\?|Sign in with Keycloak)" is visible'
safari_menu='Element not found: Text matching regex: Share)'

grep -qF -e "$photos_stuck" -e "$safari_menu" "$console"
