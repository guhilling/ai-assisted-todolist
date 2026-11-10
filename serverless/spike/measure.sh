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

aws() { command aws --region "$REGION" "$@"; }

# Back to the chosen 512 MB and variables however the run ends, so a failed run does not
# leave the next one starting from a different configuration.
restore() {
    aws lambda update-function-configuration --function-name "$FUNCTION" --memory-size 512 \
        --environment "Variables={TABLE_NAME=$TABLE}" >/dev/null || true
    rm -rf "$work"
}
trap restore EXIT

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
    }
    if i % 4 == 0:
        item["dueTime"] = {"S": "10:00"}
        item["timeZone"] = {"S": "Europe/Berlin"}
    items.append({"PutRequest": {"Item": item}})
print(json.dumps({table: items}))
EOF
# What DynamoDB left unwritten, as a new batch; empty when everything was taken.
left() {
    python3 -c 'import json, sys
u = json.load(sys.stdin)["UnprocessedItems"]
print(json.dumps(u) if u else "")'
}

# A batch can be accepted in part without an error; what is left over is written again.
batch="$(cat "$work/seed.json")"
for _ in 1 2 3 4 5 6; do
    [[ -n "$batch" ]] || break
    printf '%s' "$batch" >"$work/seed.json"
    batch="$(aws dynamodb batch-write-item --request-items "file://$work/seed.json" \
        --output json | left)"
done
[[ -z "$batch" ]] || { echo "DynamoDB did not take all twenty tasks." >&2; exit 1; }
# The user's id count (#550) up to at least twenty, so their next new task does not have to step
# over the seeded ids; a count already past it is left alone, and the refusal that says so ignored.
aws dynamodb update-item --table-name "$TABLE" \
    --key "{\"PK\": {\"S\": \"$owner\"}, \"SK\": {\"S\": \"META\"}}" \
    --update-expression "SET lastTaskId = :n" \
    --condition-expression "attribute_not_exists(lastTaskId) OR lastTaskId < :n" \
    --expression-attribute-values '{":n": {"N": "20"}}' 2>/dev/null || true

cat >"$work/event.json" <<EOF
{"version": "2.0", "routeKey": "GET /api/tasks", "rawPath": "/api/tasks",
 "requestContext": {"http": {"method": "GET", "path": "/api/tasks"},
                    "authorizer": {"jwt": {"scopes": null, "claims": {
                        "email": "$EMAIL", "email_verified": "true"}}}}}
EOF

# Invokes once; prints "<init ms or -> <duration ms> <max memory MB>", and fails on anything but
# 200. Called as `x="$(invoke)"`, so that its failure stops the script.
invoke() {
    local log
    log="$(aws lambda invoke --function-name "$FUNCTION" --cli-binary-format raw-in-base64-out \
        --payload "file://$work/event.json" --log-type Tail --query LogResult --output text \
        "$work/out.json" | base64 --decode)"
    python3 - "$work/out.json" "$log" <<'EOF'
import json, re, sys
answer, log = json.load(open(sys.argv[1])), sys.argv[2]
if answer.get("statusCode") != 200:
    sys.exit(f"The function did not answer 200: {answer}")
report = next(line for line in log.splitlines() if line.startswith("REPORT"))
init = re.search(r"Init Duration: ([\d.]+) ms", report)
print(init.group(1) if init else "-", re.search(r"\tDuration: ([\d.]+) ms", report).group(1),
      re.search(r"Max Memory Used: (\d+) MB", report).group(1))
EOF
}

row='%-6s %-6s %-10s %-12s %-24s %s\n'
# shellcheck disable=SC2059 # the format is the variable on purpose: one for header and rows
printf "$row" MB round "init ms" "cold ms" "warm ms" "max MB"
for mb in $MEMORY; do
    for round in $(seq "$ROUNDS"); do
        # A changed configuration retires every execution environment: the next call starts cold.
        aws lambda update-function-configuration --function-name "$FUNCTION" --memory-size "$mb" \
            --environment "Variables={TABLE_NAME=$TABLE,ROUND=$mb-$round-$RANDOM}" >/dev/null
        aws lambda wait function-updated-v2 --function-name "$FUNCTION"
        first="$(invoke)"
        read -r init cold used <<<"$first"
        warm=()
        for _ in 1 2 3; do
            again="$(invoke)"
            read -r _ duration _ <<<"$again"
            warm+=("$duration")
        done
        # shellcheck disable=SC2059
        printf "$row" "$mb" "$round" "$init" "$cold" "${warm[*]}" "$used"
    done
done

echo "Done; the function goes back to 512 MB."
echo "Target: init + cold under 500 ms, warm under 50 ms (doc/deployment/serverless.md)."
