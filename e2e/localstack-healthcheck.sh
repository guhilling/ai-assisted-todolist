#!/usr/bin/env bash
# Healthy once LocalStack's init scripts have run, so the bucket exists before the backend starts:
# the ready endpoint reports each init stage, and "READY" stages all completed.
set -euo pipefail

curl -fsS http://localhost:4566/_localstack/init/ready | grep -q '"completed": true'
