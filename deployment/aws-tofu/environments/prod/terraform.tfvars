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

# No Google client for prod yet, so sign-in stays off there.
google_client_id = ""

# Both versions run this long after a blue/green switch, for an instant rollback.
blue_green_bake_minutes = 5

# A rollout's last phase waits this long for connections to the old task to finish.
deregistration_delay_seconds = 30
