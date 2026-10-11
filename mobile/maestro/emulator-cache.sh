#!/usr/bin/env bash
# Keeps the emulator's setup -- the system image and an AVD with a booted snapshot -- in a private
# image on GitHub's Container Registry, so Mobile CI's emulator jobs skip installing it and booting
# it cold (#302). Neither changes between runs; together they were most of two minutes a shard.
#
#   emulator-cache.sh tag            the cache's tag for this setup, printed
#   emulator-cache.sh exists TAG     whether the cache has it (exit status)
#   emulator-cache.sh restore        unpacks this setup's cache; never fails, so a miss is a cold start
#   emulator-cache.sh save TAG       packs the setup and pushes it; emulator-cache.yml only
#   emulator-cache.sh private        fails unless the cache's package is provably private
#   emulator-cache.sh probe          creates the package, private; by hand, once, with your own token
#
# The emulator's settings are in emulator.env beside this script, for the workflows to read too. The
# tag names them, the emulator version and the system image revision -- a snapshot loads only into
# the pair that saved it, and the emulator action always installs the newest of both, which
# android-revisions.py reads from Google's index -- and a hash of emulator.env and this script, so
# any change is a new tag rather than a stale cache.
#
# Private, because the system image and the snapshot are Google's software under the Android SDK
# licence, not ours to publish. GitHub's API will not tell a workflow's own token a package's
# visibility, so `private` asks the registry instead, without credentials: a private package refuses
# an anonymous reader, a public one serves it, so a probe image in the package is what gets read.
#
# A person creates the package, with `probe`: a package a workflow creates from a public repository
# of a personal account starts out public, and a public package can never be made private again --
# the first one had to be deleted. So the workflows never create it: `save` checks the probe is there
# and private before it pushes anything, and fails when it is missing.
#
# Needs an `oras login` to ghcr.io for everything but `tag` and `private`; `restore` logs in itself
# with GH_TOKEN, so that a failed login is a cold start too.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$here/../.." && pwd)"
# shellcheck source=SCRIPTDIR/emulator.env
source "$here/emulator.env"

owner="${GITHUB_REPOSITORY_OWNER:?}"
BUILDCACHE="ghcr.io/$(tr '[:upper:]' '[:lower:]' <<< "$owner")/taskfest-buildcache"
# Empty where there is no SDK, as for `probe` on a laptop.
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
image_path="system-images;android-${EMULATOR_API_LEVEL};${EMULATOR_TARGET};${EMULATOR_ARCH}"
image_dir="$sdk/system-images/android-${EMULATOR_API_LEVEL}/${EMULATOR_TARGET}/${EMULATOR_ARCH}"
# The AVD, and adb's key the snapshot's device already trusts; adb writes adbkey.pub only in some
# versions, deriving it from adbkey otherwise, so the keys are packed where they are there.
paths=("$image_dir" "$HOME/.android/avd" "$HOME/.android/adbkey" "$HOME/.android/adbkey.pub")
archive=emulator.tar.zst
# Links the package to this repository, which is what lets the workflows' own token read it.
source_annotation="org.opencontainers.image.source=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"

tag() {
  local revisions emulator image settings
  revisions=$(python3 "$repository_root/.github/scripts/android-revisions.py" emulator "$image_path")
  emulator=$(sed -n 1p <<< "$revisions")
  image=$(sed -n 2p <<< "$revisions")
  if [[ -z "$emulator" || -z "$image" ]]; then
    echo "::error::No emulator version or system image revision from Google's index." >&2
    return 1
  fi
  settings=$(cat "$here/emulator.env" "$0" | sha256sum | cut -c1-12)
  echo "avd-${EMULATOR_API_LEVEL}-${EMULATOR_TARGET}-${EMULATOR_ARCH}-emu${emulator}-img${image}-${settings}"
}

check_private() {
  local repository="${BUILDCACHE#ghcr.io/}" response token status
  # What is checked must exist, or a refusal would prove nothing.
  if ! oras manifest fetch "${BUILDCACHE}:visibility-probe" > /dev/null 2>&1; then
    echo "::error::${BUILDCACHE}:visibility-probe is missing, so its visibility cannot be checked. Is the package there? A person creates it with \`emulator-cache.sh probe\`; doc/mobile/development.md says how." >&2
    return 1
  fi
  response=$(curl -sS "https://ghcr.io/token?scope=repository:${repository}:pull") || {
    echo "::error::Could not ask ghcr.io whether ${BUILDCACHE} is private." >&2
    return 1
  }
  # Only an explicit refusal proves it private: UNAUTHORIZED is how ghcr.io answers for a private
  # package, DENIED for one it does not have, which the probe's being there rules out. A token that
  # then reads the probe proves it public; anything else -- no token, another answer -- proves
  # nothing, and nothing is pushed on it.
  if grep -q -E '"code": *"(UNAUTHORIZED|DENIED)"' <<< "$response"; then
    echo "${BUILDCACHE} is private: it refuses an anonymous reader."
    return 0
  fi
  token=$(jq -r '.token // empty' <<< "$response" 2>/dev/null) || token=
  if [[ -z "$token" ]]; then
    echo "::error::ghcr.io neither refused an anonymous reader of ${BUILDCACHE} nor gave one a token, so its visibility is unknown." >&2
    return 1
  fi
  status=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json' \
    "https://ghcr.io/v2/${repository}/manifests/visibility-probe") || status=unknown
  if [[ "$status" == 200 ]]; then
    echo "::error::${BUILDCACHE} is PUBLIC: set it to private in its package settings, on GitHub, before the emulator's setup goes there." >&2
  else
    echo "::error::ghcr.io gave an anonymous reader of ${BUILDCACHE} a token, then answered ${status}, so its visibility is unknown." >&2
  fi
  return 1
}

restore() {
  local tag work
  tag=$(tag) || return 1
  echo "${GH_TOKEN:?}" | oras login ghcr.io --username "${GITHUB_ACTOR:?}" --password-stdin > /dev/null 2>&1 || {
    echo "Could not log in to ghcr.io."
    return 1
  }
  work=$(mktemp -d)
  oras pull "${BUILDCACHE}:${tag}" -o "$work" > /dev/null 2>&1 || {
    echo "${BUILDCACHE}:${tag} is not there (yet)."
    rm -rf "$work"
    return 1
  }
  # Half an AVD would be worse than none: the action would boot it rather than make a new one.
  if ! zstd -dc "$work/$archive" | tar -C / -xf -; then
    echo "Unpacking ${BUILDCACHE}:${tag} failed; what it had written is removed again."
    rm -rf "${paths[@]}" "$work"
    return 1
  fi
  rm -rf "$work"
  echo "The emulator's setup came from ${BUILDCACHE}:${tag}."
}

case "${1:-}" in
  tag)
    tag
    ;;

  exists)
    oras manifest fetch "${BUILDCACHE}:$2" > /dev/null 2>&1
    ;;

  restore)
    restore || echo "::notice::The emulator is set up and booted from scratch."
    ;;

  private)
    check_private
    ;;

  probe)
    work=$(mktemp -d)
    echo "Only checks this package is private; it holds nothing." > "$work/probe.txt"
    (cd "$work" && oras push --annotation "$source_annotation" "${BUILDCACHE}:visibility-probe" probe.txt > /dev/null)
    rm -rf "$work"
    check_private
    ;;

  save)
    check_private
    for required in "$image_dir" "$HOME/.android/avd" "$HOME/.android/adbkey"; do
      [[ -e "$required" ]] || { echo "::error::$required is missing, so there is no setup to cache." >&2; exit 1; }
    done
    present=()
    for path in "${paths[@]}"; do
      if [[ -e "$path" ]]; then present+=("${path#/}"); fi
    done
    work=$(mktemp -d)
    tar -C / -cf - "${present[@]}" | zstd -T0 -3 -q -o "$work/$archive"
    echo "Pushing $(du -h "$work/$archive" | cut -f1) as ${BUILDCACHE}:$2."
    (cd "$work" && oras push --annotation "$source_annotation" "${BUILDCACHE}:$2" \
      "$archive:application/vnd.taskfest.emulator.tar+zstd" > /dev/null)
    rm -rf "$work"
    ;;

  *)
    echo "usage: $0 tag | exists TAG | restore | save TAG | private | probe" >&2
    exit 2
    ;;
esac
