#!/usr/bin/env bash
# Builds the Go backend, cmd/api (#548), into dist/tasks.zip: one static arm64 binary named
# `bootstrap`, which is what Lambda's provided.al2023 runtime starts. The spike's function runs it;
# the name of the zip is the spike's, which serverless-spike.tf points to.
#
#   serverless/build.sh
#
# With Go installed it uses that; without, the official Go image through podman or docker, so
# nobody has to install Go to apply the spike.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HERE/dist"
rm -f "$HERE/dist/bootstrap" "$HERE/dist/tasks.zip"

build='CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -trimpath'
build+=' -ldflags="-s -w" -o dist/bootstrap ./cmd/api'

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

(cd "$HERE/dist" && zip -q -X tasks.zip bootstrap)
echo "Built $HERE/dist/tasks.zip"
