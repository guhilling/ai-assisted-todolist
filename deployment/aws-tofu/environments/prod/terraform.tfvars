# The whole difference between this environment and the other one. Literally: every other
# file in this directory is byte-identical to its counterpart, and
# check-environments-match.py fails the build if that stops being true.

region      = "eu-central-1"
project     = "taskfest"
environment = "prod"

vpc_cidr             = "10.30.0.0/16"
public_subnet_cidrs  = ["10.30.0.0/20", "10.30.16.0/20"]
private_subnet_cidrs = ["10.30.128.0/20", "10.30.144.0/20"]

log_retention_days = 90

hostname = "taskfest.cloud.hilling.de"

# Created by hand in the Google console; not a secret. The same web client as qa's
# (doc/decisions/mobile-app.md), with a client secret of its own in Secrets Manager.
google_client_id = "284066835041-jfetldf4tlh0hei4c54rdch0c0jn8qdk.apps.googleusercontent.com"

# The iOS app's Google client (#280), created by hand in the Google console like the web client;
# not a secret. doc/mobile/sign-in.md says how it is made.
google_ios_client_id = "284066835041-2jslp8n0p5o0p7c94220urrdo3eag4cr.apps.googleusercontent.com"

# No test accounts in prod: it signs in with Google alone.
test_sign_in = false

# Both versions run this long after a blue/green switch, for an instant rollback.
blue_green_bake_minutes = 5

# A rollout's last phase waits this long for connections to the old task to finish.
deregistration_delay_seconds = 30

# Graviton (#250): about 20% less for the same task size. qa ran on it first; Gunnar moved prod
# after qa had shown it works. Needs a release from v0.15.0 on, which plan and deploy both enforce.
cpu_architecture = "ARM64"
