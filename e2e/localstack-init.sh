#!/usr/bin/env bash
# Creates the attachment bucket of the end-to-end stack (#204), as attachments.tf creates the real
# one: private, and with a CORS rule letting the site PUT and GET -- the one cross-origin path the
# browser takes. LocalStack runs everything in /etc/localstack/init/ready.d once S3 is up; the
# health check waits for this script to have finished.
set -euo pipefail

awslocal s3api create-bucket --bucket taskfest-attachments
awslocal s3api put-bucket-cors --bucket taskfest-attachments --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }]
}'
