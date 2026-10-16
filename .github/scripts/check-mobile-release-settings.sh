#!/usr/bin/env bash
# Checks that a mobile release build has every secret and variable it needs (#276), before the
# twenty minutes of building that would otherwise end on the first one missing. Names them all
# at once, by their names in GitHub (doc/mobile/distribution.md).
#
#   check-mobile-release-settings.sh android|ios qa|prod
#
# mobile-release.yml hands the values in through the environment, under the names below.
set -euo pipefail

platform=$1
variant=$2
missing=()

need() {  # need <variable in this environment> <its name in GitHub>
  if [[ -z "${!1:-}" ]]; then missing+=("$2"); fi
}

case "$platform" in
  android)
    need UPLOAD_KEYSTORE ANDROID_UPLOAD_KEYSTORE
    need UPLOAD_KEYSTORE_PASSWORD ANDROID_UPLOAD_KEYSTORE_PASSWORD
    need UPLOAD_KEY_ALIAS ANDROID_UPLOAD_KEY_ALIAS
    need UPLOAD_KEY_PASSWORD ANDROID_UPLOAD_KEY_PASSWORD
    need WORKLOAD_IDENTITY_PROVIDER GOOGLE_WORKLOAD_IDENTITY_PROVIDER
    ;;
  ios)
    need APPLE_API_KEY APPLE_API_KEY
    need APPLE_API_KEY_ID APPLE_API_KEY_ID
    need APPLE_API_ISSUER_ID APPLE_API_ISSUER_ID
    ;;
  *)
    echo "::error::Unknown platform $platform; it is android or ios."
    exit 2
    ;;
esac

# Without them the qa app would install and offer no way to sign in.
if [[ "$variant" == qa ]]; then
  need TASKFEST_QA_COGNITO_ISSUER TASKFEST_QA_COGNITO_ISSUER
  need TASKFEST_QA_APP_CLIENT_ID TASKFEST_QA_APP_CLIENT_ID
fi

if (( ${#missing[@]} )); then
  echo "::error::Not set for the $platform $variant build: ${missing[*]} (doc/mobile/distribution.md)."
  exit 1
fi
echo "Everything the $platform $variant build needs is set."
