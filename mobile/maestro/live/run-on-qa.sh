#!/usr/bin/env bash
# Runs the app's live flows against qa on the emulator live-tests.yml has just booted (#278): the
# released qa app, signed in as qa's first test account, recording each flow's screen for the site.
#
#   run-on-qa.sh <apk>
#
# Before anything else it sets new passwords for both test accounts, as the website's signed-in
# scenarios do, and clears them (e2e/live/clear-test-accounts.task.ts); after the flows, failed or
# not, it clears them again. The passwords live in this script's environment only, masked in the
# log -- this whole script is one step of the job for that reason -- and Android is told not to show
# the last character typed into a password field, which the recordings would otherwise catch.
#
# Each flow is recorded with Android's own screenrecord, which stops at three minutes: every flow
# here takes well under that. The recordings and a list of the flows with their outcomes go to
# live-app-videos/, which collect-live-videos.py --app turns into what the site publishes.
#
# Needs: the job's AWS role (to set the passwords), LIVE_BASE_URL and ENVIRONMENT, and e2e's npm
# dependencies with Chromium installed (for the clearing).
set -euo pipefail

apk="$(realpath "$1")"
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
recordings="$repo/live-app-videos"
flows=(change-tasks attach)

source "$here/../emulator-ready.sh"

pool=$(aws cognito-idp list-user-pools --max-results 60 \
  --query "UserPools[?Name=='taskfest-${ENVIRONMENT}-test-accounts'].Id | [0]" --output text)
if [ -z "$pool" ] || [ "$pool" = "None" ]; then
  echo "::error::taskfest-${ENVIRONMENT} has no test accounts pool"
  exit 1
fi
for which in one two; do
  # 32 hex digits plus the classes the pool's policy asks for: 36 characters.
  password="$(openssl rand -hex 16)Aa1x"
  echo "::add-mask::$password"
  aws cognito-idp admin-set-user-password --user-pool-id "$pool" \
    --username "taskfest-test-${which}@example.com" --password "$password" --permanent
  export "E2E_PASSWORD_$(echo "$which" | tr '[:lower:]' '[:upper:]')=$password"
done

clear_accounts() {
  (cd "$repo/e2e" && E2E_IDENTITY=cognito npx playwright test -c playwright.live-clear.config.ts)
}
clear_accounts
trap 'clear_accounts || echo "::warning::the test accounts could not be cleared after the app run; the next run clears them first"' EXIT

retry adb shell settings put system show_password 0
retry adb install -r "$apk"
retry bash "$here/../put-attach-image.sh"

mkdir -p "$recordings"
results=()
failed=0
for flow in "${flows[@]}"; do
  file="$here/$flow.yaml"
  title=$(sed -n 's/^name: //p' "$file")
  # Each flow signs in afresh, and is recorded doing so: Chrome would otherwise keep Cognito's
  # session from the flow before and sign straight in, past the form the flow waits for.
  retry adb shell pm clear com.android.chrome >/dev/null
  # And starts from the home screen, not the flow before's last screen, while Maestro starts up.
  adb shell am force-stop de.hilling.taskfest.qa
  adb shell input keyevent KEYCODE_HOME
  # Started in the background, stopped with the interrupt screenrecord finishes its file on.
  adb shell screenrecord --bit-rate 2000000 "/sdcard/$flow.mp4" &
  recorder=$!
  started=$(date +%s%3N)
  status=passed
  maestro test "$file" -e TEST_ACCOUNT=taskfest-test-one@example.com -e "TEST_PASSWORD=$E2E_PASSWORD_ONE" \
    --test-output-dir "$repo/maestro-live-output" || status=failed
  if [ "$status" = failed ]; then
    # What Maestro saw on the screen it stopped at, for the failure's artifact: a password field's
    # text is hidden there as it is on the screen.
    maestro hierarchy > "$repo/maestro-live-output/$flow-hierarchy.json" 2>/dev/null || true
  fi
  duration=$(( $(date +%s%3N) - started ))
  adb shell pkill -INT screenrecord || true
  wait "$recorder" || true
  # screenrecord writes the file's index last; pulled before that, the video does not play.
  sleep 2
  adb pull "/sdcard/$flow.mp4" "$recordings/$flow.mp4" || echo "::warning::no recording of $flow"
  echo "$flow: $status"
  [ "$status" = passed ] || failed=1
  results+=("$(jq -n --arg flow "mobile/maestro/live/$flow.yaml" --arg title "$title" --arg status "$status" \
    --argjson duration "$duration" --arg recording "$recordings/$flow.mp4" \
    '{flow: $flow, title: $title, status: $status, durationMs: $duration, recording: $recording}')")
done
printf '%s\n' "${results[@]}" | jq -s . > "$recordings/flows.json"

exit "$failed"
