#!/usr/bin/env python3
"""
Deploys one release of the Go backend to one environment (#555).

Run by deploy-serverless.yml as the environment's deploy role, with the release's four function
zips, which release.yml built once and attached to the release, downloaded into a directory:

    python3 .github/scripts/deploy-serverless.py --environment qa --version v1.6.0 --dist dist/

What it does, in order -- the API function first, then streams, orphans and replay:

1. Uploads the function's zip to its unpublished code, `$LATEST`, and publishes that as a version
   whose description is the release. The settings OpenTofu applied come with it.
2. For the API function, checks the new version before anything serves it: invokes it with a
   request as API Gateway sends one, without the header only CloudFront sends, which the function
   must refuse with a 403 (`lambdahttp.FromOrigin`). An answer means the code starts -- its
   settings read, its secrets fetched, its table reached -- and handles a request. Anything else
   stops the deploy with every alias where it was.
3. Moves the function's alias `live`, which API Gateway, the stream and the schedules invoke, to
   the new version. Only then is it served.

A failure after an alias has moved moves every alias moved so far back to its previous version, so
the functions never run different releases. The jobs are not invoked to check them: a run of
orphans or replay does real work, and a failing one raises its alarm.

A rollback is this again with the previous release's tag, whose zips are still on its release.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys
import tempfile

# The Go backend's functions, in the order they are deployed: the API first, the one checked.
FUNCTIONS = ("api", "streams", "orphans", "replay")

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
    """Runs an AWS CLI command and returns its JSON answer, or an empty one."""
    output = subprocess.run(["aws", *args, "--output", "json"], check=True,
                            capture_output=True, text=True).stdout
    return json.loads(output) if output.strip() else {}


def zip_of(dist, version, command):
    """The function's zip as release.yml names it."""
    return pathlib.Path(dist) / f"taskfest-serverless-{version.removeprefix('v')}-{command}.zip"


def publish(aws, name, archive, version):
    """Uploads the code and publishes it as a version described by the release; returns the version."""
    aws("lambda", "update-function-code", "--function-name", name, "--zip-file", f"fileb://{archive}")
    aws("lambda", "wait", "function-updated-v2", "--function-name", name)
    number = aws("lambda", "publish-version", "--function-name", name, "--description", version)["Version"]
    aws("lambda", "wait", "published-version-active", "--function-name", name, "--qualifier", number)
    return number


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
    missing = [str(path) for path in archives.values() if not path.is_file()]
    if missing:
        raise SystemExit(f"::error::The release has no {', '.join(missing)}")

    moved = []
    try:
        for command in FUNCTIONS:
            name = f"taskfest-{environment}-{command}"
            number = publish(aws, name, archives[command], version)
            if command == "api":
                check_api(aws, name, number)
            previous = aws("lambda", "get-alias", "--function-name", name, "--name", ALIAS)["FunctionVersion"]
            aws("lambda", "update-alias", "--function-name", name, "--name", ALIAS, "--function-version", number)
            moved.append((name, previous))
            print(f"{name}: {ALIAS} now runs version {number} ({version}), was {previous}.")
    except BaseException:
        for name, previous in reversed(moved):
            aws("lambda", "update-alias", "--function-name", name, "--name", ALIAS, "--function-version", previous)
            print(f"{name}: {ALIAS} moved back to version {previous}.", file=sys.stderr)
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
