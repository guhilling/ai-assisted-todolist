#!/usr/bin/env bash
# Waits for the end-to-end stack, started in the background so it comes up while the emulator
# boots, and puts a task on gunnar's board for the flows to find (#267). With a bearer token, as the app
# sends one (#266): Keycloak's password grant stands in for the browser sign-in the flows do for real.
set -euo pipefail

# The background start first, so two `compose up` never race; then everything healthy.
if [[ -f stack-start.pid ]]; then
  while kill -0 "$(cat stack-start.pid)" 2>/dev/null; do sleep 1; done
  cat stack-start.log
fi
docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait
# --wait returns once httpd's container runs, not once it listens: the frontend has no health
# check. The same probe e2e.yml makes before its browser, so the seed below never meets a reset.
curl -sS --retry 60 --retry-delay 2 --retry-all-errors --fail http://localhost:3000/api/auth/providers > /dev/null

# The flows look for the seeded task under "Today" -- every sign-in does, and a share signs in
# several times -- and the app takes today from the emulator, whose clock is the runner's
# (emulator-ready.sh) and whose time zone is UTC: runs that crossed midnight UTC found it overdue
# (#407). Either share's last flow ends about four and a half minutes after this point, so a run
# seeding in the last quarter of an hour before midnight waits for the new day first.
until_midnight=$(( 86400 - $(date -u +%s) % 86400 ))
if (( until_midnight < 900 )); then
  echo "Midnight UTC is ${until_midnight} s away: waiting for the new day before seeding (#407)."
  sleep $(( until_midnight + 5 ))
fi

token=$(curl -sS --fail http://localhost:8082/realms/taskfest/protocol/openid-connect/token \
  -d grant_type=password -d scope=openid -d client_id=taskfest-backend -d client_secret=taskfest-secret \
  -d username=gunnar -d password=gunnar | jq -r .id_token)
curl -sS --fail http://localhost:3000/api/tasks -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"description\":\"Seeded by CI for the app\",\"dueDate\":\"$(date -u +%F)\",\"importance\":\"HIGH\",\"state\":\"TODO\"}"
