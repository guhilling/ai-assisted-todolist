# Sets a new random password on both of the environment's test accounts and exports them as
# E2E_PASSWORD_ONE and E2E_PASSWORD_TWO, masked in the log (#144, #278). Sourced -- never run --
# by the step that uses them, so they live in that step's environment only and are gone when it
# ends: live-tests.yml's signed-in scenarios, and mobile/maestro/live/run-on-qa.sh for the app.
#
# Needs ENVIRONMENT and the environment's live-test role, which may do this and nothing else.

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
unset password
