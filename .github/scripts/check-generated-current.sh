#!/usr/bin/env bash
# Fails when the paths given differ from HEAD after their generator ran: a file it changed, a new
# one it wrote, or one it deleted (#611). Run from the directory the paths are relative to.
#
#   check-generated-current.sh "<what to run to fix it>" <path>...
#
# `git status --porcelain` sees all three in one command and leaves the index alone. The pair it
# replaces, `git add --all --intent-to-add` and `git diff`, missed a deleted file when the diff was
# against the index (#610), and a new one without the add -- each copy in a workflow got one of the
# two halves wrong at some point, which is why there is one copy now.
set -euo pipefail

fix="$1"
shift
changed=$(git status --porcelain --untracked-files=all -- "$@")
if [[ -n "$changed" ]]; then
    echo "$changed"
    git diff -- "$@" | sed -n '1,200p'
    echo "::error::Generated files are out of date (above). Run: $fix"
    exit 1
fi
echo "Generated files are current: $*"
