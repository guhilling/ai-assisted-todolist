# The whole difference between this environment and the other one. Literally: every other
# file in this directory is byte-identical to its counterpart, and
# check-environments-match.py fails the build if that stops being true.

region      = "eu-central-1"
project     = "taskfest"
environment = "qa"

vpc_cidr             = "10.20.0.0/16"
public_subnet_cidrs  = ["10.20.0.0/20", "10.20.16.0/20"]
private_subnet_cidrs = ["10.20.128.0/20", "10.20.144.0/20"]

log_retention_days = 30

hostname = "taskfest-qa.cloud.hilling.de"

# Created by hand in the Google console; not a secret. The client secret is in Secrets Manager.
google_client_id = "284066835041-jfetldf4tlh0hei4c54rdch0c0jn8qdk.apps.googleusercontent.com"

# The iOS app's Google client (#280), created by hand in the Google console like the web client;
# not a secret. doc/mobile/sign-in.md says how it is made.
google_ios_client_id = "284066835041-9mkopigj4vltdejq0j5r7fib714p0ef0.apps.googleusercontent.com"

# The Cognito test accounts the live tests sign in with (#190). qa only.
test_sign_in = true

# Both versions run this long after a blue/green switch, for an instant rollback.
blue_green_bake_minutes = 2

# A rollout's last phase waits this long for connections to the old task to finish.
deregistration_delay_seconds = 5

# Graviton (#250): about 20% less for the same task size. qa went first; prod runs on it too.
cpu_architecture = "ARM64"

# The backend's size (#535): qa tries a quarter vCPU and 0.5 GB, half the cost of prod's size.
backend_cpu    = 256
backend_memory = 512

# qa tries the Go backend first (#557), whether the environment is up or not. Its table starts
# empty; the containers' data stays in RDS, and "containers" here brings it back.
api_backend = "serverless"

# The Go backend's own table; a restored one's name only after a switch to it (serverless.md).
# Restored from an on-demand backup on 2026-11-13, as the trial of the procedure (#553).
table_name = "taskfest-qa-data-restored-2026-11-13"

# qa restores from an on-demand backup when it must; prod keeps point-in-time recovery (#553).
table_point_in_time_recovery = false

# The Go backend's logs also go to the shared monitoring server (#508), with the password in
# /taskfest/qa/monitoring-password (doc/deployment/observability.md, "The monitoring server").
monitoring_endpoint = "https://monitoring.cloud.hilling.de"
