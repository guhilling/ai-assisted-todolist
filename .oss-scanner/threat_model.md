<!-- Template: copy to your project or place a copy at projects/<name>/threat_model.md. Free text; the scanner reads it before it starts. -->
# Threat model

## What this project does and where untrusted input enters
- "a demo tasklist web application, REST backend. we assume all input is untrusted"

## Components that matter most / least
- "the frontend (spa) as well as the backend (REST/quarkus application)

## How to exercise it
- "frontend and backend have unit tests, end2end tests are in e2e, documentation for local testing is in docs"

## How you rate severity
- "unvalidated urls are severe, unauthorized access to backend is severe, problems in the aws security are severe"

## Anything to leave alone
- "do not report hardcoded credential for qa stage or email test-addresses in the code"
