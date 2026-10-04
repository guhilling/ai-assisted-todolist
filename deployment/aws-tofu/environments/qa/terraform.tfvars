# The whole difference between this environment and the other one. Literally: every other
# file in this directory is byte-identical to its counterpart, and
# check-environments-match.py fails the build if that stops being true.

region      = "eu-central-1"
project     = "todolist"
environment = "qa"

vpc_cidr             = "10.20.0.0/16"
public_subnet_cidrs  = ["10.20.0.0/20", "10.20.16.0/20"]
private_subnet_cidrs = ["10.20.128.0/20", "10.20.144.0/20"]

log_retention_days = 30

hostname = "todolist-qa.cloud.hilling.de"

# Created by hand in the Google console; not a secret. The client secret is in Secrets Manager.
google_client_id = "284066835041-jfetldf4tlh0hei4c54rdch0c0jn8qdk.apps.googleusercontent.com"

# Both versions run this long after a blue/green switch, for an instant rollback.
blue_green_bake_minutes = 2

# A rollout's last phase waits this long for connections to the old task to finish.
deregistration_delay_seconds = 5
