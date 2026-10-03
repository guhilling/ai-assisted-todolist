#!/usr/bin/env python3
"""
Turns SonarCloud's quality gate on main into at most one open GitHub issue.

Run by sonarcloud.yml after the analysis of main:

    python3 .github/scripts/sonar-gate-issue.py

SonarCloud runs only on main, after the merge -- it re-ran the whole backend suite on every pull
request, and was the check everything else waited for. That leaves this script as the only way a
failed gate reaches a person, so it is deliberately boring:

- gate failed, no open issue    -> open one, naming the failing conditions
- gate failed, issue open       -> comment on it, rather than opening a duplicate
- gate passed, issue open       -> close it, saying which commit fixed it
- gate passed, nothing open     -> nothing

The issue carries the label below, which is how the next run finds it. Needs GH_TOKEN (issues:
write) and SONAR_TOKEN in the environment, plus GITHUB_SHA, GITHUB_SERVER_URL, GITHUB_REPOSITORY
and GITHUB_RUN_ID, which Actions sets.
"""

import base64
import dataclasses
import json
import os
import subprocess
import sys
import urllib.request

PROJECT = "guhilling_ai-assisted-todolist"
BRANCH = "main"
LABEL = "sonarcloud-gate"
DASHBOARD = f"https://sonarcloud.io/summary/new_code?id={PROJECT}&branch={BRANCH}"


@dataclasses.dataclass
class Action:
    """What to do about the issue: create, comment, close or none."""
    kind: str
    issue: int | None = None
    body: str = ""


def decide(gate, open_issue, sha, run_url):
    """The whole policy, as a pure function of the gate result and the open issue, if any."""
    status = gate["projectStatus"]["status"]
    if status not in ("OK", "ERROR"):
        # NONE (no gate computed) or anything new: proving nothing must not close an issue.
        raise ValueError(f"quality gate status {status!r} is neither OK nor ERROR")

    if status == "OK":
        if open_issue is None:
            return Action("none")
        return Action("close", open_issue,
                      f"The quality gate passes again as of {sha[:7]} ({run_url}). Closing.")

    failing = [c for c in gate["projectStatus"].get("conditions", []) if c["status"] == "ERROR"]
    rows = "\n".join(
        f"| `{c['metricKey']}` | {c.get('actualValue', '?')} | "
        f"{c.get('comparator', '')} {c.get('errorThreshold', '?')} |"
        for c in failing
    )
    body = (
        f"SonarCloud's quality gate failed on `{BRANCH}` at {sha[:7]}.\n\n"
        f"| Condition | Actual | Fails when |\n| --- | --- | --- |\n{rows}\n\n"
        f"Details: {DASHBOARD}\nRun: {run_url}\n\n"
        f"This issue was opened by `sonar-gate-issue.py`. It gets a comment while the gate keeps "
        f"failing, and closes itself once the gate passes on `{BRANCH}` again."
    )
    if open_issue is None:
        return Action("create", None, body)
    return Action("comment", open_issue, body)


def fetch_gate():
    url = (f"https://sonarcloud.io/api/qualitygates/project_status"
           f"?projectKey={PROJECT}&branch={BRANCH}")
    request = urllib.request.Request(url)
    token = os.environ.get("SONAR_TOKEN")
    if token:
        request.add_header("Authorization",
                           "Basic " + base64.b64encode(f"{token}:".encode()).decode())
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def find_open_issue():
    found = json.loads(gh("issue", "list", "--label", LABEL, "--state", "open",
                          "--json", "number", "--limit", "1"))
    return found[0]["number"] if found else None


def main():
    run_url = (f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}"
               f"/actions/runs/{os.environ['GITHUB_RUN_ID']}")
    action = decide(fetch_gate(), find_open_issue(), os.environ["GITHUB_SHA"], run_url)

    if action.kind == "create":
        gh("label", "create", LABEL, "--force", "--color", "D93F0B",
           "--description", "SonarCloud's quality gate failed on main")
        print(gh("issue", "create", "--label", LABEL,
                 "--title", "SonarCloud's quality gate fails on main", "--body", action.body))
    elif action.kind == "comment":
        gh("issue", "comment", str(action.issue), "--body", action.body)
        print(f"Commented on #{action.issue}")
    elif action.kind == "close":
        gh("issue", "close", str(action.issue), "--comment", action.body)
        print(f"Closed #{action.issue}")
    else:
        print("Quality gate passes, no open issue: nothing to do.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
