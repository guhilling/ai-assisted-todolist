#!/usr/bin/env bash
# Runs a build that pulls from a container registry, and runs it again when -- and only when -- a
# download broke off midway. Quay ended the backend's base image early twice on 11 October 2026
# (6 MB of 63, 23 MB of 62), and Jib, which builds the backend image, has no setting to retry; a
# test or compile failure is not retried and keeps its exit status.
#
#   retry-on-broken-download.sh COMMAND [ARG ...]
#
# Up to three runs. Running a Jib build again is safe even where it pushes: the image comes out the
# same, and the push puts the same digest under the same tag.
set -uo pipefail

attempts=3
# What the registry client logs when a body ends before its Content-Length, or the peer drops it.
broken='Premature end of Content-Length delimited message body|java\.net\.SocketException: Connection reset'

log=$(mktemp)
trap 'rm -f "$log"' EXIT
for (( run = 1; ; run++ )); do
  "$@" 2>&1 | tee "$log"
  status=${PIPESTATUS[0]}
  if (( status == 0 )) || ! grep -q -E "$broken" "$log"; then
    exit "$status"
  fi
  if (( run == attempts )); then
    echo "::error::A download broke off in each of ${attempts} runs; giving up."
    exit "$status"
  fi
  echo "::warning::A download broke off (run ${run} of ${attempts}); running the build again."
done
