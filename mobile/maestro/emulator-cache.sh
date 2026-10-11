#!/usr/bin/env bash
# Keeps the emulator's setup -- the system image and an AVD with a booted snapshot -- in a private
# image on GitHub's Container Registry, so Mobile CI's emulator jobs skip installing it and booting
# it cold (#302). Neither changes between runs; together they were most of two minutes a shard.
#
#   emulator-cache.sh tag            the cache's tag for this setup, printed
#   emulator-cache.sh exists TAG     whether the cache has it (exit status)
#   emulator-cache.sh restore TAG    unpacks it, if it is there; never fails, so a miss is a cold start
#   emulator-cache.sh save TAG       packs the setup and pushes it; main only
#   emulator-cache.sh private        fails unless the cache's package is private; main, every run
#
# The tag names the API level, image and emulator version, and a hash of the settings below and of
# this script, so a change to any of them is a new tag rather than a stale cache. A snapshot only
# loads into the emulator version that saved it, and the emulator action always installs the newest
# one, so `tag` installs it first to read its version; the action's own install is then a no-op.
#
# Private, because the system image and the snapshot are Google's software under the Android SDK
# licence, not ours to publish. `save` pushes a probe first and refuses to push the setup unless
# the package is private: an image pushed from a public repository may start out public. `private`
# checks it again on every run on main, so it cannot turn public later unnoticed.
#
# Needs BUILDCACHE (the image, without a tag), EMULATOR_API_LEVEL, EMULATOR_TARGET, EMULATOR_ARCH
# and EMULATOR_OPTIONS from the workflow, an `oras login` to ghcr.io, and GH_TOKEN for `save`.
set -euo pipefail

sdk="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
image_dir="$sdk/system-images/android-${EMULATOR_API_LEVEL}/${EMULATOR_TARGET}/${EMULATOR_ARCH}"
# The AVD, and adb's key the snapshot's device already trusts.
paths=("$image_dir" "$HOME/.android/avd" "$HOME/.android/adbkey" "$HOME/.android/adbkey.pub")
archive=emulator.tar.zst
# Links the package to this repository, which is what lets the workflows' own token read it.
source_annotation="org.opencontainers.image.source=${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}"

emulator_version() {
  local sdkmanager="$sdk/cmdline-tools/latest/bin/sdkmanager"
  if ! "$sdkmanager" --install emulator --channel=0 > /dev/null 2>&1; then
    yes | "$sdkmanager" --licenses > /dev/null 2>&1 || true
    "$sdkmanager" --install emulator --channel=0 > /dev/null
  fi
  sed -n 's/^Pkg\.Revision=//p' "$sdk/emulator/source.properties"
}

check_private() {
  local visibility
  visibility=$(gh api "users/${GITHUB_REPOSITORY_OWNER}/packages/container/${BUILDCACHE##*/}" -q .visibility) || true
  if [[ "$visibility" != private ]]; then
    echo "::error::${BUILDCACHE} is ${visibility:-of unknown visibility}, not private: set it to private in its package settings, on GitHub, before the emulator's setup goes there." >&2
    return 1
  fi
  echo "${BUILDCACHE} is private."
}

case "${1:-}" in
  tag)
    settings=$(printf '%s\n' "$EMULATOR_API_LEVEL" "$EMULATOR_TARGET" "$EMULATOR_ARCH" "$EMULATOR_OPTIONS" |
      cat - "$0" | sha256sum | cut -c1-12)
    echo "avd-${EMULATOR_API_LEVEL}-${EMULATOR_TARGET}-${EMULATOR_ARCH}-emu$(emulator_version)-${settings}"
    ;;

  exists)
    oras manifest fetch "${BUILDCACHE}:$2" > /dev/null 2>&1
    ;;

  restore)
    work=$(mktemp -d)
    if oras pull "${BUILDCACHE}:$2" -o "$work" > /dev/null 2>&1 &&
      zstd -dc "$work/$archive" | tar -C / -xf -; then
      echo "The emulator's setup came from ${BUILDCACHE}:$2."
    else
      echo "::notice::${BUILDCACHE}:$2 is not there (yet): the emulator is set up and booted from scratch."
    fi
    rm -rf "$work"
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
    (cd "$work" && oras push --annotation "$source_annotation" "${BUILDCACHE}:$2" "$archive:application/vnd.taskfest.emulator.tar+zstd" > /dev/null)
    rm -rf "$work"
    ;;

  *)
    echo "usage: $0 tag | exists TAG | restore TAG | save TAG | private" >&2
    exit 2
    ;;
esac
