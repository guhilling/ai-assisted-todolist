#!/usr/bin/env bash
# Sets up the Go backend's end-to-end stack (#556), as OpenTofu sets up an environment: the table in
# DynamoDB Local, with its TTL; and the attachment bucket in SeaweedFS, private, with the CORS rule
# letting the site PUT and GET -- the one cross-origin path the browser takes. Run once by the
# stack's `serverless-init` service, which the backend waits for; both stores may still be
# starting, so each step is tried until it answers.
set -euo pipefail

retry() {
    local answer
    for _ in $(seq 1 60); do
        if answer=$("$@" 2>&1); then
            return 0
        fi
        sleep 2
    done
    echo "Gave up: $*" >&2
    echo "Its last answer: $answer" >&2
    return 1
}

dynamodb=(aws dynamodb --endpoint-url "$DYNAMODB_ENDPOINT")
s3=(aws s3api --endpoint-url "$S3_ENDPOINT")

retry "${dynamodb[@]}" list-tables
if ! "${dynamodb[@]}" describe-table --table-name "$TABLE_NAME" >/dev/null 2>&1; then
    "${dynamodb[@]}" create-table --table-name "$TABLE_NAME" --billing-mode PAY_PER_REQUEST \
        --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
        --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE >/dev/null
    "${dynamodb[@]}" update-time-to-live --table-name "$TABLE_NAME" \
        --time-to-live-specification Enabled=true,AttributeName=expiresAt >/dev/null
fi

retry "${s3[@]}" list-buckets
if ! "${s3[@]}" head-bucket --bucket "$TASKFEST_ATTACHMENTS_BUCKET" >/dev/null 2>&1; then
    "${s3[@]}" create-bucket --bucket "$TASKFEST_ATTACHMENTS_BUCKET" >/dev/null
fi
"${s3[@]}" put-bucket-cors --bucket "$TASKFEST_ATTACHMENTS_BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }]
}'
echo "The table $TABLE_NAME and the bucket $TASKFEST_ATTACHMENTS_BUCKET are ready."
