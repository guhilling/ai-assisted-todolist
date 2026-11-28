# The whole difference between this environment and the other one. Literally: every other
# file in this directory is byte-identical to its counterpart, and
# check-environments-match.py fails the build if that stops being true.

region      = "eu-central-1"
project     = "taskfest"
environment = "qa"

log_retention_days = 30

hostname = "taskfest-qa.cloud.hilling.de"

# Created by hand in the Google console, in qa's own Google project, kept in Testing for its
# test users (doc/decisions/authentication.md); not a secret. The client secret is in Secrets
# Manager.
google_client_id = "991424339063-auqt7m5oru8up2if8dus2s2372oris98.apps.googleusercontent.com"

# The iOS app's Google client (#280), created by hand in the Google console like the web client;
# not a secret. doc/mobile/sign-in.md says how it is made.
google_ios_client_id = "991424339063-gc2t5erjcsj2om3n26r8b81mtfleujmo.apps.googleusercontent.com"

# The Cognito test accounts the live tests sign in with (#190). qa only.
test_sign_in = true

# The Go backend's own table; a restored one's name only after a switch to it (serverless.md).
# Restored from an on-demand backup on 2026-11-13, as the trial of the procedure (#553).
table_name = "taskfest-qa-data-restored-2026-11-13"

# qa restores from an on-demand backup when it must; prod keeps point-in-time recovery (#553).
table_point_in_time_recovery = false

# The Go backend's logs also go to the shared monitoring server (#508), with the password in
# /taskfest/qa/monitoring-password (doc/deployment/observability.md, "The monitoring server").
monitoring_endpoint = "https://monitoring.cloud.hilling.de"
