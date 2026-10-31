#!/usr/bin/env bash
# Says whether a flow failed because Maestro's own driver did, not the flow: exits 0 when any of
# the given files -- Maestro's console output, its JUnit report -- names one, 1 otherwise.
#
#   driver-failed.sh FILE [FILE ...]
#
# On a freshly booted simulator the driver sometimes starts too slowly, or goes away mid-tap,
# before anything is shared (#401): three of nineteen runs of main failed that way, none in the
# share. On the emulator it has failed its first call, before any step ran (#445). The runners,
# ios/run-on-simulator.sh and run-on-emulator.sh, run a flow once more after these, and only after
# these.
set -uo pipefail

# iOS's, then Android's.
driver='DeviceUnreachableException|IOSDriverTimeoutException|XCUITestServerError|DeviceCallFailedException'

# A file Maestro never wrote counts as saying nothing; with none at all, grep would read stdin.
(( $# > 0 )) && grep -q -s -E "$driver" "$@"
(( $? == 0 ))
