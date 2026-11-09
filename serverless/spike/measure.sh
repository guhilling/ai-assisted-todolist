#!/usr/bin/env bash
# Measures the spike's cold and warm start in qa (#535), as an administrator:
#
#   AWS_PROFILE=<admin profile> serverless/spike/measure.sh
#
# It uploads dist/tasks.zip (run serverless/build.sh first), writes twenty tasks for the test
# account taskfest-test-one@example.com into the spike's table, and then, for each memory size,
# forces fresh execution environments by changing a variable and invokes the function cold once
# and warm three times, with the event API Gateway's JWT authorizer would send. Lambda's own
# REPORT line gives the numbers. A few hundred invocations at most: inside the free tier.
#
# Settings, all optional: MEMORY="128 256 512" (MB), ROUNDS=5 (cold starts per size).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGION=eu-central-1
FUNCTION=taskfest-qa-spike-tasks
TABLE=taskfest-qa-spike
EMAIL=taskfest-test-one@example.com
MEMORY="${MEMORY:-128 256 512}"
ROUNDS="${ROUNDS:-5}"
ZIP="$HERE/../dist/tasks.zip"

[[ -f "$ZIP" ]] || { echo "No $ZIP: run serverless/build.sh first." >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

aws() { command aws --region "$REGION" "$@"; }

echo "Uploading the function's code."
aws lambda update-function-code --function-name "$FUNCTION" --zip-file "fileb://$ZIP" >/dev/null
aws lambda wait function-updated-v2 --function-name "$FUNCTION"

echo "Writing twenty tasks for $EMAIL."
owner="USER#$(printf '%s' "$EMAIL" | shasum -a 256 | cut -d' ' -f1)"
python3 - "$owner" "$TABLE" >"$work/seed.json" <<'EOF'
import json, sys
owner, table = sys.argv[1], sys.argv[2]
importances = ["HIGH", "MEDIUM", "LOW"]
items = []
for i in range(1, 21):
    item = {
        "PK": {"S": owner}, "SK": {"S": f"TASK#{i:08d}"}, "id": {"N": str(i)},
        "description": {"S": f"Spike task {i}"}, "dueDate": {"S": f"2026-12-{(i % 28) + 1:02d}"},
        "importance": {"S": importances[i % 3]}, "state": {"S": "TODO"},
        "createdAt": {"S": f"2026-11-09T20:{i:02d}:00Z"},
    }
    if i % 4 == 0:
        item["dueTime"] = {"S": "10:00"}
        item["timeZone"] = {"S": "Europe/Berlin"}
    items.append({"PutRequest": {"Item": item}})
print(json.dumps({table: items}))
EOF
aws dynamodb batch-write-item --request-items "file://$work/seed.json" >/dev/null

cat >"$work/event.json" <<EOF
{"version": "2.0", "routeKey": "GET /api/tasks", "rawPath": "/api/tasks",
 "requestContext": {"http": {"method": "GET", "path": "/api/tasks"},
                    "authorizer": {"jwt": {"claims": {"email": "$EMAIL"}, "scopes": null}}}}
EOF

# Invokes once; prints "<init ms or -> <duration ms> <max memory MB>", and fails on anything but 200.
invoke() {
    local result report
    result="$(aws lambda invoke --function-name "$FUNCTION" --cli-binary-format raw-in-base64-out \
        --payload "file://$work/event.json" --log-type Tail --query LogResult --output text "$work/out.json")"
    python3 -c 'import json,sys; s=json.load(open(sys.argv[1])).get("statusCode"); sys.exit(s != 200)' \
        "$work/out.json" || { echo "The function did not answer 200:" >&2; cat "$work/out.json" >&2; exit 1; }
    report="$(printf '%s' "$result" | base64 --decode | grep '^REPORT')"
    python3 - "$report" <<'EOF'
import re, sys
r = sys.argv[1]
init = re.search(r"Init Duration: ([\d.]+) ms", r)
print(init.group(1) if init else "-", re.search(r"\tDuration: ([\d.]+) ms", r).group(1),
      re.search(r"Max Memory Used: (\d+) MB", r).group(1))
EOF
}

printf '%-6s %-6s %-10s %-12s %-24s %s\n' MB round "init ms" "cold ms" "warm ms" "max MB"
for mb in $MEMORY; do
    for round in $(seq "$ROUNDS"); do
        # A changed configuration retires every execution environment: the next call starts cold.
        aws lambda update-function-configuration --function-name "$FUNCTION" --memory-size "$mb" \
            --environment "Variables={TABLE_NAME=$TABLE,ROUND=$mb-$round-$RANDOM}" >/dev/null
        aws lambda wait function-updated-v2 --function-name "$FUNCTION"
        read -r init cold used < <(invoke)
        warm=()
        for _ in 1 2 3; do read -r _ duration _ < <(invoke); warm+=("$duration"); done
        printf '%-6s %-6s %-10s %-12s %-24s %s\n' "$mb" "$round" "$init" "$cold" "${warm[*]}" "$used"
    done
done

aws lambda update-function-configuration --function-name "$FUNCTION" --memory-size 256 \
    --environment "Variables={TABLE_NAME=$TABLE}" >/dev/null
echo "Back at 256 MB. Success means init + cold under 500 ms, warm under 50 ms (serverless.md)."
