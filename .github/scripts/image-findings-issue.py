#!/usr/bin/env python3
"""
Turns Amazon Inspector's findings on the running backend images into at most one GitHub issue.

Run every six hours by image-findings.yml, with credentials for the read-only findings role:

    python3 .github/scripts/image-findings-issue.py

ECS pulls the images through ECR's pull-through cache, and Inspector scans every image the cache
holds -- again whenever a new CVE is published, not only when the image arrives (#162). This
script asks for the findings worth a person's attention and keeps one issue in step with them:

- findings, no open issue        -> open one, listing them -- except findings in the last issue a
                                    person closed, which count as looked at (see below)
- findings, issue open           -> rewrite its list; comment only on findings not listed before,
                                    so a notification means something new
- no findings, issue open        -> close it
- no findings, nothing open      -> nothing

**Closing the issue by hand acknowledges what it lists.** A person closes it once the findings are
dealt with -- fixed, accepted, or judged irrelevant, which a real triage has to decide anyway. Those
findings are then not raised again; a finding that was not listed opens a new issue with just
that one. When the script closes the issue itself because the findings are gone, it clears the
list first, so the closing acknowledges nothing and a finding that comes back -- a rollback to an
old image -- is reported again. doc/deployment/image-scanning.md has the workflow.

"Worth attention" is narrow on purpose: HIGH or CRITICAL, a fixed version exists, and ECS used
the image in the last 30 days -- by Inspector's in-use record, or because the image arrived in
ECR in that time. The second is needed because Inspector refreshes in-use data only now and then,
so a freshly deployed image could go unreported for a day, or for good if the environment is
down again by then. Through the pull-through cache an image arrives exactly when ECS first pulls
it, so its arrival date is a first use that is known at once. The price: an image pulled but
never run for long -- a rolled-back deploy, a debugging pull, the digest `latest` just moved
away from -- stays in scope for its 30 days too. Most of what Inspector reports for the backend
is in the base image's OS packages with no fix released yet, and an issue about those would be
noise nobody can act on.

The issue carries the label below, and its body ends in a hidden list of what it reported, which
is how the next run finds it and tells new findings from known ones. Needs GH_TOKEN (issues:
write), AWS credentials and AWS_REGION in the environment, plus GITHUB_SERVER_URL,
GITHUB_REPOSITORY and GITHUB_RUN_ID, which Actions sets.
"""

import dataclasses
import json
import os
import re
import subprocess
import sys
import time

LABEL = "image-vulnerability"
TITLE = "Fixable HIGH or CRITICAL vulnerabilities in a recently used image"
REPOSITORY_PREFIX = "quay/"
IN_USE_DAYS = 30
SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1}
KNOWN = re.compile(r"<!-- reported: (.*?) -->")


@dataclasses.dataclass
class Action:
    """What to do about the issue: create, update, close or none."""
    kind: str
    issue: int | None = None
    body: str = ""
    comment: str = ""


def reported(body):
    """The finding keys an issue body lists in its hidden marker; empty if it lists none."""
    match = KNOWN.search(body or "")
    return set(match.group(1).split()) if match else set()


def filter_criteria(now, days=IN_USE_DAYS, window="ecrImageLastInUseAt"):
    """The Inspector filter for findings worth an issue, as list-findings takes it.

    `window` names the date that has to fall in the last `days`: when ECS last used the image,
    or when it arrived in ECR (`ecrImagePushedAt`).
    """
    equals = lambda value: {"comparison": "EQUALS", "value": value}
    return {
        "findingStatus": [equals("ACTIVE")],
        "findingType": [equals("PACKAGE_VULNERABILITY")],
        "severity": [equals("HIGH"), equals("CRITICAL")],
        "fixAvailable": [equals("YES")],
        "ecrImageRepositoryName": [{"comparison": "PREFIX", "value": REPOSITORY_PREFIX}],
        window: [{"startInclusive": now - days * 86400, "endInclusive": now}],
    }


def queries(now, days=IN_USE_DAYS):
    """The two filters whose results together are the findings worth an issue.

    Inspector's filter fields are combined with AND, so "used recently OR arrived recently" is two
    queries, merged afterwards.
    """
    return [filter_criteria(now, days), filter_criteria(now, days, window="ecrImagePushedAt")]


def merge(*results):
    """The findings of several queries, each once, in the order first seen."""
    seen, merged = set(), []
    for found in results:
        for f in found:
            if f["findingArn"] not in seen:
                seen.add(f["findingArn"])
                merged.append(f)
    return merged


@dataclasses.dataclass
class Row:
    """One vulnerability in one package, with every image it was found in."""
    severity: str
    cve: str
    url: str
    package: str
    version: str
    fixed: str
    images: set

    @property
    def key(self):
        return f"{self.cve}/{self.package}"


def rows(found):
    """Folds Inspector's per-image findings into one row per vulnerability and package."""
    merged = {}
    for f in found:
        details = f["packageVulnerabilityDetails"]
        image = f["resources"][0]["details"]["awsEcrContainerImage"]
        names = {f"{image['repositoryName']}:{tag}" for tag in image.get("imageTags") or ["(untagged)"]}
        for package in details["vulnerablePackages"]:
            row = Row(f["severity"], details["vulnerabilityId"], details.get("sourceUrl", ""),
                      package["name"], package.get("version", "?"),
                      package.get("fixedInVersion", "?"), set())
            merged.setdefault(row.key, row).images |= names
    return sorted(merged.values(), key=lambda r: (SEVERITY_ORDER.get(r.severity, 9), r.cve, r.package))


def table(listed):
    lines = ["| Vulnerability | Severity | Package | Installed | Fixed in | Images |",
             "| --- | --- | --- | --- | --- | --- |"]
    for r in listed:
        cve = f"[{r.cve}]({r.url})" if r.url else r.cve
        images = ", ".join(f"`{i}`" for i in sorted(r.images))
        lines.append(f"| {cve} | {r.severity} | `{r.package}` | {r.version} | {r.fixed} | {images} |")
    return "\n".join(lines)


def decide(found, open_issue, run_url, acknowledged=frozenset()):
    """The whole policy, as a pure function of the findings, the open issue if any, and the
    finding keys a person acknowledged by closing the last issue."""
    listed = rows(found)
    if not listed:
        if open_issue is None:
            return Action("none")
        return Action("close", open_issue["number"],
                      body=KNOWN.sub("<!-- reported:  -->", open_issue.get("body") or ""),
                      comment=f"No fixable HIGH or CRITICAL findings remain in recently used images "
                              f"({run_url}). Closing.")
    if open_issue is None:
        listed = [r for r in listed if r.key not in acknowledged]
        if not listed:
            return Action("none")

    body = (
        f"Amazon Inspector reports fixable HIGH or CRITICAL vulnerabilities in backend images that "
        f"ECS used in the last {IN_USE_DAYS} days.\n\n{table(listed)}\n\n"
        f"Most of these are fixed by moving a dependency or the base image to the version in "
        f"*Fixed in*, through Renovate as usual, and releasing. Run: {run_url}\n\n"
        f"This issue is kept up to date by `image-findings-issue.py` (#162). It is rewritten "
        f"every six hours, gets a comment only when a new finding appears, and closes itself once none "
        f"are left. **Close it by hand once the findings are dealt with** -- fixed, accepted or judged "
        f"irrelevant; the same findings are then not raised again, and a new one opens a new issue.\n\n<!-- reported: {' '.join(r.key for r in listed)} -->"
    )
    if open_issue is None:
        return Action("create", body=body)

    known = reported(open_issue.get("body"))
    new = [r for r in listed if r.key not in known]
    comment = f"New since the last report:\n\n{table(new)}" if new else ""
    return Action("update", open_issue["number"], body=body, comment=comment)


def list_findings():
    def query(criteria):
        output = subprocess.run(["aws", "inspector2", "list-findings", "--filter-criteria",
                                 json.dumps(criteria), "--output", "json"],
                                check=True, capture_output=True, text=True).stdout
        return json.loads(output).get("findings", [])

    return merge(*(query(criteria) for criteria in queries(int(time.time()))))


def gh(*args):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def find_open_issue():
    found = json.loads(gh("issue", "list", "--label", LABEL, "--state", "open",
                          "--json", "number,body", "--limit", "1"))
    return found[0] if found else None


def last_acknowledged():
    """The findings listed by the most recent closed issue, which a person closed by hand -- the
    script empties the list of any issue it closes itself."""
    closed = json.loads(gh("issue", "list", "--label", LABEL, "--state", "closed",
                           "--json", "body", "--limit", "1"))
    return reported(closed[0]["body"]) if closed else set()


def main():
    run_url = (f"{os.environ['GITHUB_SERVER_URL']}/{os.environ['GITHUB_REPOSITORY']}"
               f"/actions/runs/{os.environ['GITHUB_RUN_ID']}")
    action = decide(list_findings(), find_open_issue(), run_url, acknowledged=last_acknowledged())

    if action.kind == "create":
        gh("label", "create", LABEL, "--force", "--color", "B60205",
           "--description", "Amazon Inspector found a fixable vulnerability in a running image")
        print(gh("issue", "create", "--label", LABEL, "--title", TITLE, "--body", action.body))
    elif action.kind == "update":
        gh("issue", "edit", str(action.issue), "--body", action.body)
        if action.comment:
            gh("issue", "comment", str(action.issue), "--body", action.comment)
        print(f"Updated #{action.issue}" + (" and commented on the new findings" if action.comment else ""))
    elif action.kind == "close":
        gh("issue", "edit", str(action.issue), "--body", action.body)
        gh("issue", "close", str(action.issue), "--comment", action.comment)
        print(f"Closed #{action.issue}")
    else:
        print("No unacknowledged fixable HIGH or CRITICAL findings, no open issue: nothing to do.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
