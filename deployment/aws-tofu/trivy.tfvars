# Read by the Trivy scan only, never by an apply.
#
# Every billable resource carries `count = var.running ? 1 : 0`, and `running` defaults to false,
# so a scan with the defaults evaluates every one of them to zero instances and checks none of
# them -- the database passed a misconfiguration scan by not existing. Scanning as if the
# environment were up is what puts billable.tf in front of the checks at all.
running = true

# Likewise for qa's test accounts (test-sign-in.tf): off by default, so without this the scan
# would check none of them.
test_sign_in = true
