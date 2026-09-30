# Everything that costs money while it exists.
#
# This file is separate so that "what does this environment cost when it is up?" has one answer
# you can read, and so the rule below has somewhere to apply.
#
# **Every resource in this file carries `count = var.running ? 1 : 0`.** That is what makes
# tearing an environment down a parameter change rather than a `tofu destroy` that has to be
# aimed carefully. It is checked, not remembered: `check-billable-guard.py` fails the build on a
# resource here without the guard, because the failure mode otherwise is silent -- teardown
# simply leaves that resource running, and the first evidence is the bill.
#
# Referring to a guarded resource means indexing it, `aws_db_instance.this[0].endpoint`, or using
# `one(aws_db_instance.this)` where a null is acceptable.
#
# Nothing lives here yet. The database, the load balancer and its target groups, and the ECS
# service arrive in the changes that add them.
