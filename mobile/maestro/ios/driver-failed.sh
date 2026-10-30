#!/usr/bin/env bash
# Says whether a flow failed because Maestro's own driver did, not the flow: exits 0 when any of
# the given files -- Maestro's console output, its JUnit report -- names one, 1 otherwise.
#
#   driver-failed.sh FILE [FILE ...]
#
# On a freshly booted simulator the driver sometimes starts too slowly, or goes away mid-tap,
# before anything is shared (#401): three of nineteen runs of main failed that way, none in the
# share. run-on-simulator.sh runs the flow once more after these, and only after these.
set -uo pipefail

driver='DeviceUnreachableException|IOSDriverTimeoutException|XCUITestServerError'

# A file Maestro never wrote counts as saying nothing; with none at all, grep would read stdin.
(( $# > 0 )) && grep -q -s -E "$driver" "$@"
(( $? == 0 ))
