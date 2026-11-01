#!/usr/bin/env bash
# Says whether a flow failed because Maestro's own driver did, not the flow: exits 0 when any of
# the given files -- Maestro's console output, its JUnit report, on iOS its own log and the XCTest
# runner's -- names one, 1 otherwise.
#
#   driver-failed.sh FILE [FILE ...]
#
# On a freshly booted simulator the driver sometimes starts too slowly, or goes away mid-tap,
# before anything is shared (#401): three of nineteen runs of main failed that way, none in the
# share. On the emulator it has failed its first call, deviceInfo, before any step ran (#445): only
# that call counts there, since a run after a later one would start from a board, or a share, the
# first run had already changed. On the simulator, too, a tap on Open in iOS's question once hung in
# the XCTest runner while the app it opened was starting (#473): the runner gave the request up
# after 100 s, and Maestro failed the tap with an error of no name of its own -- "Unknown error" in
# its report. Only the three together count, so Maestro's log and the runner's are handed in with
# the others: an unknown error alone may be the flow's, and so may one after a request the runner
# gave up on earlier and got over -- so the tap must have failed within a minute after the runner
# gave a request up (16 s in that run). The runner's log is in UTC and Maestro's in the machine's
# time, which on GitHub's runners is UTC too; elsewhere they seldom match, and the failure is the
# flow's, the safe side. The runners, ios/run-on-simulator.sh and run-on-emulator.sh, run a
# flow once more after these, and only after these. An emulator that went away altogether is
# emulator-lost.sh's (#461): a flow cannot run again on it.
set -uo pipefail

# iOS's, then Android's.
driver="DeviceUnreachableException|IOSDriverTimeoutException|XCUITestServerError|DeviceCallFailedException: 'deviceInfo' failed"

# The XCTest runner giving a request up, Maestro's log on the tap that failed, and its report.
hung="handler error: Task timed out"
tap_failed="CliConsoleListener.onCommandFinished: Tap on .* FAILED"
unknown="<failure>Unknown error</failure>"

# Whether a tap failed in Maestro's log at most 60 s after the runner gave a request up in its own,
# by the time of day: seconds since midnight, a minute's wrap past it included.
tap_failed_after_hang() {
  # Only the files there are: awk, unlike grep -s, stops at one it cannot read.
  local readable=()
  for file in "$@"; do [[ -r $file ]] && readable+=("$file"); done
  (( ${#readable[@]} > 0 )) || return 1
  awk -v hung="$hung" -v tap_failed="$tap_failed" '
    function seconds(time) { split(time, part, ":"); return part[1] * 3600 + part[2] * 60 + part[3] }
    FILENAME ~ /xctest_runner_[^\/]*\.log$/ && index($0, hung) { hangs[++n] = seconds($2) }
    FILENAME ~ /(^|\/)maestro\.log$/ && $0 ~ tap_failed { taps[++m] = seconds($1) }
    END {
      for (i = 1; i <= n; i++) for (j = 1; j <= m; j++) {
        after = (taps[j] - hangs[i] + 86400) % 86400
        if (after <= 60) exit 0
      }
      exit 1
    }' "${readable[@]}"
}

# The exceptions above are looked for in the console output and the report only: the logs also
# name ones Maestro got over, or an app's crash, and a flow failing after those is the flow's.
reports=()
for file in "$@"; do
  case $(basename "$file") in maestro.log | xctest_runner_*.log) ;; *) reports+=("$file") ;; esac
done

# A file Maestro never wrote counts as saying nothing; with none at all, grep would read stdin.
(( $# > 0 )) || exit 1
{ (( ${#reports[@]} > 0 )) && grep -q -s -E "$driver" "${reports[@]}"; } ||
  { grep -q -s -F "$unknown" "$@" && tap_failed_after_hang "$@"; }
# grep says 2 for a file it could not read; the script says 1 for anything but a driver failure.
(( $? == 0 ))
