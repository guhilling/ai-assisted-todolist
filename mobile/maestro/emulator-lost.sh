#!/usr/bin/env bash
# Says whether an Android flow failed because the emulator itself went away: exits 0 when any of
# the given files -- Maestro's console output, its JUnit report -- says adb lost the device, 1
# otherwise.
#
#   emulator-lost.sh FILE [FILE ...]
#
# Mobile CI's emulator has now and then gone in the middle of a flow (#461): its process ended
# without a word, adb first called the device offline and then no longer listed it, and the
# emulator action could not even reach it to shut it down. A flow cannot run again on an emulator
# that is gone, so run-on-emulator.sh stops there and leaves emulator-lost.txt behind, and Mobile CI
# runs the whole share once more on a freshly booted emulator and a fresh stack -- not the flow
# alone, which would start from a board the first run may already have changed. Maestro's driver
# failing on an emulator that is still there is driver-failed.sh's, and is run again in place.
#
# Only adb no longer listing the emulator counts, not its calling it offline: it does that for a
# moment now and then (emulator-ready.sh), and a flow that failed by itself meanwhile would be run
# again, its failure hidden.
set -uo pipefail

lost="device 'emulator-[0-9]+' not found"

# A file Maestro never wrote counts as saying nothing; with none at all, grep would read stdin.
(( $# > 0 )) && grep -q -s -E "$lost" "$@"
(( $? == 0 ))
