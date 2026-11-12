#!/usr/bin/env bash
# Builds the Go backend's four functions (#554) into dist/<command>.zip: api, streams, orphans and
# replay, each one static arm64 binary named `bootstrap`, which is what Lambda's provided.al2023
# runtime starts. OpenTofu creates each function from its zip once (serverless.tf has the API's,
# serverless-jobs.tf the others); a release deploys its own (#555).
#
#   serverless/build.sh
#
# With Go installed it uses that; without, the official Go image through podman or docker, so
# nobody has to install Go to apply the infrastructure.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HERE/dist"
commands=(api streams orphans replay)

build='set -e; for c in '"${commands[*]}"'; do'
build+=' CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -trimpath'
# $c expands where the loop runs, here or in the container, not now.
# shellcheck disable=SC2016
build+=' -ldflags="-s -w" -o "dist/$c/bootstrap" "./cmd/$c"; done'

for c in "${commands[@]}"; do
    rm -rf "${HERE:?}/dist/$c" "$HERE/dist/$c.zip"
done

if command -v go >/dev/null; then
    (cd "$HERE" && eval "$build")
else
    engine="$(command -v podman || command -v docker || true)"
    if [[ -z "$engine" ]]; then
        echo "Needs Go, podman or docker." >&2
        exit 1
    fi
    version="$(sed -n 's/^go \([0-9.]*\).*/\1/p' "$HERE/go.mod")"
    "$engine" run --rm -v "$HERE:/src" -w /src "docker.io/library/golang:${version}" sh -c "$build"
fi

for c in "${commands[@]}"; do
    (cd "$HERE/dist/$c" && zip -q -X "../$c.zip" bootstrap)
done
echo "Built ${commands[*]} into $HERE/dist"
