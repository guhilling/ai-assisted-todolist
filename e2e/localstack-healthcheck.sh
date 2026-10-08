#!/usr/bin/env bash
# Healthy once the bucket exists with its CORS rule -- what the init script is for, and what the
# backend and the browser need. Asking for the rule, rather than whether the init stage ran, also
# catches an init script that ran and failed: LocalStack reports that stage completed either way.
set -euo pipefail

awslocal s3api get-bucket-cors --bucket taskfest-attachments > /dev/null
