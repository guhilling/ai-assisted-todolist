# Read by the Trivy scan only, never by an apply.
#
# qa's test accounts (test-sign-in.tf) are off by default, so a scan with the defaults would
# evaluate every one of their resources to zero instances and check none of them.
test_sign_in = true
