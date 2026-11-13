#!/usr/bin/env python3
"""
Deploys one release of the Go backend to one environment (#555).

Run by deploy-serverless.yml as the environment's deploy role, with the release's function
zips, which release.yml built once and attached to the release, downloaded into a directory:

    python3 .github/scripts/deploy-serverless.py --environment qa --version v1.6.0 --dist dist/

What it does, in three steps, so that nothing new serves until everything is ready:

1. For each function -- api, streams, orphans, replay, logship -- uploads its zip to the unpublished code,
   `$LATEST`, and publishes exactly that code (by its SHA-256) as a version described by the
   release. The settings OpenTofu applied come with it. An alias still on `$LATEST`, as OpenTofu
   creates it, is first pinned on a version of what runs, so the upload does not serve the new
   code before its check.
2. Checks the API's new version: invokes it with a request as API Gateway sends one, without the
   header only CloudFront sends, which it must refuse with a 403 (`lambdahttp.FromOrigin`). An
   answer means the code starts -- its settings read, its secrets fetched, its table reached -- and
   handles a request. The jobs are not invoked, since a run does real work; a failing one raises
   its alarm.
3. Moves each function's alias `live`, which API Gateway, the stream and the schedules invoke, to
   its new version. A failure here moves every alias back to its previous version, each tried on
   its own, so the functions do not run different releases.

Anything failing before step 3 leaves every alias where it was. A rollback is this again with the
previous release's tag, whose zips are still on its release. A change of a function's settings by
OpenTofu reaches what serves only through a deploy, since a published version keeps its own:
redeploying the current release publishes them (doc/deployment/serverless.md).
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys
import tempfile

# The Go backend's functions, in the order they are deployed: the API first, the one checked.
FUNCTIONS = ("api", "streams", "orphans", "replay", "logship")

# The functions added after a release, by the last release without them: a deploy of that
# release or an older one, a rollback, leaves them where they are. logship came after v1.6.1 (#508).
LAST_WITHOUT = {"logship": (1, 6, 1)}

# The alias everything that invokes a function names (serverless.tf, serverless-jobs.tf).
ALIAS = "live"

# What the deploy workflows accept as a release, and nothing else: it reaches file names.
RELEASE_TAG = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$")

# A request as API Gateway's HTTP API hands it to the function, payload format 2.0, for the API's
# public /api/version -- and without X-Origin-Verify, so a working function refuses it.
CHECK_REQUEST = {
    "version": "2.0",
    "routeKey": "$default",
    "rawPath": "/api/version",
    "rawQueryString": "",
    "headers": {"user-agent": "deploy-serverless"},
    "requestContext": {
        "http": {"method": "GET", "path": "/api/version", "protocol": "HTTP/1.1",
                 "sourceIp": "127.0.0.1", "userAgent": "deploy-serverless"},
        "requestId": "deploy-serverless-check",
        "routeKey": "$default",
        "stage": "$default",
    },
    "isBase64Encoded": False,
}


def aws(*args):
    """Runs an AWS CLI command and returns its JSON answer, saying what AWS answered when it fails."""
    try:
        output = subprocess.run(["aws", *args, "--output", "json"], check=True,
                                capture_output=True, text=True).stdout
    except subprocess.CalledProcessError as failure:
        print(f"aws {' '.join(args[:2])}: {failure.stderr}", file=sys.stderr)
        raise
    return json.loads(output) if output.strip() else {}


def zip_of(dist, version, command):
    """The function's zip as release.yml names it."""
    return pathlib.Path(dist) / f"taskfest-serverless-{version.removeprefix('v')}-{command}.zip"


def published(aws, name, description, code=None):
    """Publishes the function's unpublished code as a version, once it is ready; returns the version."""
    aws("lambda", "wait", "function-updated-v2", "--function-name", name)
    args = ["--description", description] + (["--code-sha256", code] if code else [])
    number = aws("lambda", "publish-version", "--function-name", name, *args)["Version"]
    aws("lambda", "wait", "published-version-active", "--function-name", name, "--qualifier", number)
    return number


def alias(aws, name):
    """The version the function's alias names."""
    return aws("lambda", "get-alias", "--function-name", name, "--name", ALIAS)["FunctionVersion"]


def move(aws, name, number):
    """Points the function's alias at the version."""
    aws("lambda", "update-alias", "--function-name", name, "--name", ALIAS, "--function-version", number)


def check_api(aws, name, number):
    """Stops the deploy unless the API's new version refuses a request without CloudFront's header."""
    with tempfile.TemporaryDirectory() as scratch:
        request = pathlib.Path(scratch) / "request.json"
        request.write_text(json.dumps(CHECK_REQUEST))
        answer = pathlib.Path(scratch) / "answer.json"
        result = aws("lambda", "invoke", "--function-name", name, "--qualifier", number,
                     "--cli-binary-format", "raw-in-base64-out", "--payload", f"fileb://{request}",
                     str(answer))
        response = json.loads(answer.read_text() or "{}")
    if result.get("FunctionError") or response.get("statusCode") != 403:
        raise SystemExit(f"::error::{name} version {number} did not answer as it should "
                         f"({result.get('FunctionError') or response.get('statusCode')}); "
                         "no alias was moved")
    print(f"{name} version {number} starts and refuses a request without CloudFront's header.")


def deploy(environment, version, dist, aws=aws):
    """Deploys the release's functions to the environment, as the module's docstring says."""
    if not RELEASE_TAG.match(version):
        raise SystemExit(f"::error::'{version}' is not a release tag like v1.2.3")
    archives = {command: zip_of(dist, version, command) for command in FUNCTIONS}
    number = tuple(int(part) for part in version[1:].split("-")[0].split("."))
    older = [command for command, last in LAST_WITHOUT.items()
             if number <= last and not archives[command].is_file()]
    functions = [command for command in FUNCTIONS if command not in older]
    for command in older:
        print(f"{version} has no {command}; it stays as it is.")
    missing = [str(archives[command]) for command in functions if not archives[command].is_file()]
    if missing:
        raise SystemExit(f"::error::The release has no {', '.join(missing)}")

    names = {command: f"taskfest-{environment}-{command}" for command in functions}
    previous, new = {}, {}
    for command in functions:
        name = names[command]
        previous[command] = alias(aws, name)
        if previous[command] == "$LATEST":
            previous[command] = published(aws, name, f"pinned before {version}")
            move(aws, name, previous[command])
            print(f"{name}: {ALIAS} pinned on version {previous[command]}, what ran before {version}.")
        code = aws("lambda", "update-function-code", "--function-name", name,
                   "--zip-file", f"fileb://{archives[command]}")["CodeSha256"]
        new[command] = published(aws, name, version, code)
        print(f"{name}: {version} published as version {new[command]}.")

    check_api(aws, names["api"], new["api"])

    moved = []
    try:
        for command in functions:
            # Counted as moved before the call, which may take effect and still fail on the way back.
            moved.append(command)
            move(aws, names[command], new[command])
            print(f"{names[command]}: {ALIAS} now runs version {new[command]} ({version}), "
                  f"was {previous[command]}.")
    except BaseException:
        for command in reversed(moved):
            try:
                move(aws, names[command], previous[command])
                print(f"{names[command]}: {ALIAS} moved back to version {previous[command]}.", file=sys.stderr)
            except Exception as failure:  # noqa: BLE001 -- every alias gets its try
                print(f"::error::{names[command]}: {ALIAS} could not be moved back to version "
                      f"{previous[command]}: {failure}", file=sys.stderr)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--environment", required=True, choices=["qa", "prod"])
    parser.add_argument("--version", required=True)
    parser.add_argument("--dist", required=True)
    args = parser.parse_args()
    deploy(args.environment, args.version, args.dist)


if __name__ == "__main__":
    main()
