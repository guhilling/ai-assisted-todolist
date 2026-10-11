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

token=$(curl -sS --fail http://localhost:8082/realms/taskfest/protocol/openid-connect/token \
  -d grant_type=password -d scope=openid -d client_id=taskfest-backend -d client_secret=taskfest-secret \
  -d username=gunnar -d password=gunnar | jq -r .id_token)
curl -sS --fail http://localhost:3000/api/tasks -H "Authorization: Bearer $token" \
  -H 'Content-Type: application/json' \
  -d "{\"description\":\"Seeded by CI for the app\",\"dueDate\":\"$(date -u +%F)\",\"importance\":\"HIGH\",\"state\":\"TODO\"}"
