#!/usr/bin/env bash
# Says whether a flow failed because Maestro's own driver did, not the flow: exits 0 when any of
# the given files -- Maestro's console output, its JUnit report, on iOS the XCTest runner's log --
# names one, 1 otherwise.
#
#   driver-failed.sh FILE [FILE ...]
#
# On a freshly booted simulator the driver sometimes starts too slowly, or goes away mid-tap,
# before anything is shared (#401): three of nineteen runs of main failed that way, none in the
# share. On the emulator it has failed its first call, deviceInfo, before any step ran (#445): only
# that call counts there, since a run after a later one would start from a board, or a share, the
# first run had already changed. On the simulator, too, a tap on Open in iOS's question once hung in
# the XCTest runner while the app it opened was starting (#473): the runner gave the request up
# after 100 s, and Maestro failed with an error of no name of its own -- "Unknown error" in its
# report. Only the two together count, so the runner's log is handed in with the others: an unknown
# error alone may be the flow's. The runners, ios/run-on-simulator.sh and run-on-emulator.sh, run a
# flow once more after these, and only after these. An emulator that went away altogether is
# emulator-lost.sh's (#461): a flow cannot run again on it.
set -uo pipefail

# iOS's, then Android's.
driver="DeviceUnreachableException|IOSDriverTimeoutException|XCUITestServerError|DeviceCallFailedException: 'deviceInfo' failed"

# The XCTest runner giving a request up, and Maestro's report on the failure it then had.
hung="handler error: Task timed out"
unknown="<failure>Unknown error</failure>"

# A file Maestro never wrote counts as saying nothing; with none at all, grep would read stdin.
(( $# > 0 )) || exit 1
grep -q -s -E "$driver" "$@" || { grep -q -s -F "$hung" "$@" && grep -q -s -F "$unknown" "$@"; }
(( $? == 0 ))
