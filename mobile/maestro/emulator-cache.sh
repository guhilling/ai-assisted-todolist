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
# an anonymous reader, a public one serves it. `save` pushes a probe first and pushes the setup only
# once that check has passed, since an image pushed from a public repository may start out public.
#
# Needs an `oras login` to ghcr.io for everything but `tag` and `private`; `restore` logs in itself
# with GH_TOKEN, so that a failed login is a cold start too.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repository_root="$(cd "$here/../.." && pwd)"
# shellcheck source=emulator.env
source "$here/emulator.env"

owner="${GITHUB_REPOSITORY_OWNER:?}"
BUILDCACHE="ghcr.io/${owner,,}/taskfest-buildcache"
sdk="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
image_path="system-images;android-${EMULATOR_API_LEVEL};${EMULATOR_TARGET};${EMULATOR_ARCH}"
image_dir="$sdk/system-images/android-${EMULATOR_API_LEVEL}/${EMULATOR_TARGET}/${EMULATOR_ARCH}"
# The AVD, and adb's key the snapshot's device already trusts.
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
    echo "::error::${BUILDCACHE}:visibility-probe is missing, so its visibility cannot be checked." >&2
    return 1
  fi
  response=$(curl -sS "https://ghcr.io/token?scope=repository:${repository}:pull") || {
    echo "::error::Could not ask ghcr.io whether ${BUILDCACHE} is private." >&2
    return 1
  }
  if grep -q '"DENIED"' <<< "$response"; then
    echo "${BUILDCACHE} is private: it refuses an anonymous reader."
    return 0
  fi
  token=$(jq -r '.token // empty' <<< "$response")
  status=$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${token}" \
    -H 'Accept: application/vnd.oci.image.manifest.v1+json' \
    "https://ghcr.io/v2/${repository}/manifests/visibility-probe") || status=unknown
  case "$status" in
    401 | 403 | 404)
      echo "${BUILDCACHE} is private: it refuses an anonymous reader."
      ;;
    200)
      echo "::error::${BUILDCACHE} is PUBLIC: set it to private in its package settings, on GitHub, before the emulator's setup goes there." >&2
      return 1
      ;;
    *)
      echo "::error::ghcr.io answered ${status} for an anonymous read of ${BUILDCACHE}, so its visibility is unknown." >&2
      return 1
      ;;
  esac
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

  save)
    work=$(mktemp -d)
    echo "Only checks this package is private; it holds nothing." > "$work/probe.txt"
    (cd "$work" && oras push --annotation "$source_annotation" "${BUILDCACHE}:visibility-probe" probe.txt > /dev/null)
    check_private
    tar -C / -cf - "${paths[@]#/}" | zstd -T0 -3 -q -o "$work/$archive"
    echo "Pushing $(du -h "$work/$archive" | cut -f1) as ${BUILDCACHE}:$2."
    (cd "$work" && oras push --annotation "$source_annotation" "${BUILDCACHE}:$2" \
      "$archive:application/vnd.taskfest.emulator.tar+zstd" > /dev/null)
    rm -rf "$work"
    ;;

  *)
    echo "usage: $0 tag | exists TAG | restore | save TAG | private" >&2
    exit 2
    ;;
esac
