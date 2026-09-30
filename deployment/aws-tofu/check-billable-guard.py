#!/usr/bin/env python3
"""
Fails when a resource that costs money is not behind the teardown switch.

Run it from anywhere:

    python3 deployment/aws-tofu/check-billable-guard.py

Tearing an environment down is a parameter change here -- `running = false` -- rather than a
`tofu destroy` that has to be aimed at the right resources. That only works if every billable
resource is actually guarded, and the failure mode when one is not is silent: the teardown
succeeds, the resource keeps running, and the first evidence is the bill a month later.

So the rule is mechanical. Every `resource` block in modules/environment/billable.tf carries

    count = var.running ? 1 : 0

and this check fails the build on one that does not. It is a deliberately literal string match:
a cleverer equivalent that this script cannot recognise is still a resource somebody has to
reason about, and the whole point is not having to.
"""

import pathlib
import re
import sys

GUARD = "count = var.running ? 1 : 0"
BILLABLE = pathlib.Path(__file__).resolve().parent / "modules" / "environment" / "billable.tf"

RESOURCE = re.compile(r'^resource\s+"([^"]+)"\s+"([^"]+)"\s*\{', re.MULTILINE)


def blocks(text):
    """Yield (type, name, body) for each top-level resource block, by brace matching."""
    for match in RESOURCE.finditer(text):
        depth, i = 0, match.start()
        while True:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        yield match.group(1), match.group(2), text[match.start():i + 1]


def main():
    if not BILLABLE.exists():
        print(f"{BILLABLE} is missing; nothing to check.", file=sys.stderr)
        return 1

    text = BILLABLE.read_text()
    unguarded = [
        f"{kind}.{name}"
        for kind, name, body in blocks(text)
        if GUARD not in " ".join(body.split())
    ]

    if unguarded:
        print(
            f"Billable resources without the teardown guard in {BILLABLE.name}:\n",
            file=sys.stderr,
        )
        for name in unguarded:
            print(f"  - {name}", file=sys.stderr)
        print(
            f"\nEach needs `{GUARD}`, or tearing the environment down will leave it running.",
            file=sys.stderr,
        )
        return 1

    count = sum(1 for _ in blocks(text))
    print(f"{BILLABLE.name}: {count} billable resource(s), all behind the teardown guard.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
