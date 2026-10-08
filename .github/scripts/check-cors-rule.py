#!/usr/bin/env python3
"""
Fails when the attachment bucket's CORS rule differs between AWS and the end-to-end stack.

Run it from anywhere:

    python3 .github/scripts/check-cors-rule.py

The rule lets the site PUT and GET files straight to and from S3 (#204), and it lives twice: in the
OpenTofu module (`attachments.tf`), for the real buckets, and in the LocalStack init script of the
Compose end-to-end stack (`e2e/localstack-init.sh`), which the browser suite runs against. The
point of the second is to be the first: a header the frontend starts sending, added to one rule
and not the other, would have the end-to-end run pass where qa fails, or the other way round.

The methods, the headers and the max age must agree. The origins differ by design -- the site's
own address in AWS, http://localhost:3000 in the stack -- and are not compared. Headers are
compared without case, as HTTP does.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
TOFU = ROOT / "deployment" / "aws-tofu" / "modules" / "environment" / "attachments.tf"
LOCALSTACK = ROOT / "e2e" / "localstack-init.sh"


def _strings(hcl_list: str) -> list:
    return re.findall(r'"([^"]*)"', hcl_list)


def tofu_rule(text: str) -> dict:
    """The rule in the OpenTofu module's `cors_rule` block."""
    block = re.search(r"cors_rule\s*\{(.*?)\n\s*\}", text, re.S)
    if not block:
        raise ValueError("no cors_rule block in the OpenTofu module")
    body = block.group(1)
    methods = re.search(r"allowed_methods\s*=\s*\[(.*?)\]", body, re.S)
    headers = re.search(r"allowed_headers\s*=\s*\[(.*?)\]", body, re.S)
    max_age = re.search(r"max_age_seconds\s*=\s*(\d+)", body)
    if not (methods and headers and max_age):
        raise ValueError("the cors_rule block lacks allowed_methods, allowed_headers or max_age_seconds")
    return {
        "methods": set(_strings(methods.group(1))),
        "headers": {header.lower() for header in _strings(headers.group(1))},
        "max_age": int(max_age.group(1)),
    }


def localstack_rule(text: str) -> dict:
    """The rule the init script passes to `put-bucket-cors`, as the JSON it is."""
    configuration = re.search(r"--cors-configuration\s+'(.*?)'", text, re.S)
    if not configuration:
        raise ValueError("no --cors-configuration in the LocalStack init script")
    rules = json.loads(configuration.group(1))["CORSRules"]
    if len(rules) != 1:
        raise ValueError(f"expected one CORS rule in the LocalStack init script, found {len(rules)}")
    rule = rules[0]
    return {
        "methods": set(rule["AllowedMethods"]),
        "headers": {header.lower() for header in rule["AllowedHeaders"]},
        "max_age": int(rule["MaxAgeSeconds"]),
    }


def differences(tofu: dict, localstack: dict) -> list:
    """What differs, one line per field, sorted so a message is stable."""
    def shown(value):
        return "{" + ", ".join(repr(item) for item in sorted(value)) + "}" if isinstance(value, set) else str(value)
    return [
        f"{field}: {shown(tofu[field])} in OpenTofu, {shown(localstack[field])} in LocalStack"
        for field in ("methods", "headers", "max_age")
        if tofu[field] != localstack[field]
    ]


def main() -> int:
    found = differences(tofu_rule(TOFU.read_text()), localstack_rule(LOCALSTACK.read_text()))
    if found:
        print(f"The attachment bucket's CORS rule differs between {TOFU.relative_to(ROOT)} and "
              f"{LOCALSTACK.relative_to(ROOT)}:", file=sys.stderr)
        for line in found:
            print(f"  {line}", file=sys.stderr)
        return 1
    print("The attachment bucket's CORS rule is the same in AWS and the end-to-end stack.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
