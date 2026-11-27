# The whole difference between this environment and the other one. Literally: every other
# file in this directory is byte-identical to its counterpart, and
# check-environments-match.py fails the build if that stops being true.

region      = "eu-central-1"
project     = "taskfest"
environment = "prod"

log_retention_days = 90

hostname = "taskfest.cloud.hilling.de"

# Created by hand in the Google console, in prod's Google project, which is published; not a
# secret. The client secret is in Secrets Manager.
google_client_id = "284066835041-jfetldf4tlh0hei4c54rdch0c0jn8qdk.apps.googleusercontent.com"

# The iOS app's Google client (#280), created by hand in the Google console like the web client;
# not a secret. doc/mobile/sign-in.md says how it is made.
google_ios_client_id = "284066835041-2jslp8n0p5o0p7c94220urrdo3eag4cr.apps.googleusercontent.com"

# No test accounts in prod: it signs in with Google alone.
test_sign_in = false

# The Go backend's own table; a restored one's name only after a switch to it (serverless.md).
table_name = ""

# Point-in-time recovery for the Go backend's table, as decided on #553.
table_point_in_time_recovery = true

# The Go backend's logs also go to the shared monitoring server (#508), with the password in
# /taskfest/prod/monitoring-password (doc/deployment/observability.md, "The monitoring server").
monitoring_endpoint = "https://monitoring.cloud.hilling.de"
