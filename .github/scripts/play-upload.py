#!/usr/bin/env python3
"""
Uploads one Android App Bundle to Google Play and releases it to the internal testers (#276).

Run by mobile-release.yml, once per variant, after the signed bundle is built:

    python3 .github/scripts/play-upload.py --package de.hilling.taskfest.qa \\
        --bundle app-release.aab --release-name 1.4.0

One edit of the app, as Play's publishing API wants it: open the edit, upload the bundle, put
it on the internal track as the only release there, commit. Two refusals have a known cause and
get a sentence instead of an error code:

- **Play has never had a build of the app.** The API cannot make an app's first upload; that one
  is made by hand in Play Console (doc/mobile/distribution.md), and every later one works.
- **The app is still a draft in Play Console** -- its setup tasks are not done -- and a draft app
  takes only draft releases. The bundle is then released as a draft, which a person rolls out
  in Play Console; the run still succeeds, with a warning.

Needs GOOGLE_ACCESS_TOKEN, a token for the androidpublisher scope -- google-github-actions/auth
mints it through Workload Identity Federation, so no key is stored anywhere -- and
GITHUB_STEP_SUMMARY (optional).
"""

import argparse
import dataclasses
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD_API = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"
TRACK = "internal"
DRAFT_ONLY = "draft app"


class ApiError(Exception):
    """Play refused a call: the HTTP status and Google's message."""

    def __init__(self, status, message):
        super().__init__(f"Google Play answered {status}: {message}")
        self.status = status
        self.message = message


class FirstUploadByHand(Exception):
    """Play has no build of the app yet, and the API cannot make the first upload."""


@dataclasses.dataclass
class Result:
    """What Play holds now: the bundle's version code, and whether testers have it or it is a draft."""
    version_code: int
    status: str


class Play:
    """Play's publishing API over HTTPS, authorised with a short-lived access token."""

    def __init__(self, token):
        self.token = token

    def request(self, method, url, body=None, content_type="application/json"):
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": content_type})
        try:
            with urllib.request.urlopen(req, timeout=600) as response:
                text = response.read().decode()
        except urllib.error.HTTPError as error:
            raise ApiError(error.code, _message(error.read().decode())) from None
        return json.loads(text) if text else {}


def _message(text):
    """Google's error message out of its error document, or the text as it came."""
    try:
        return json.loads(text)["error"]["message"]
    except (ValueError, KeyError, TypeError):
        return text


def upload(api, package, bundle, release_name):
    """Uploads the bundle in one edit and releases it on the internal track."""
    edits = f"{API}/{package}/edits"
    try:
        edit = api.request("POST", edits)["id"]
    except ApiError as error:
        if error.status == 404:
            raise FirstUploadByHand(
                f"Google Play has no build of {package} yet, and its API cannot make the first upload. "
                "Upload this run's bundle by hand once, in Play Console under Test and release -> "
                "Internal testing (doc/mobile/distribution.md); later releases upload by themselves.") from None
        raise
    uploaded = api.request("POST", f"{UPLOAD_API}/{package}/edits/{edit}/bundles?uploadType=media",
                           bundle, "application/octet-stream")
    version_code = int(uploaded["versionCode"])

    def release(status):
        api.request("PUT", f"{edits}/{edit}/tracks/{TRACK}", {
            "track": TRACK,
            "releases": [{"name": release_name, "versionCodes": [str(version_code)], "status": status}],
        })
        api.request("POST", f"{edits}/{edit}:commit")

    try:
        release("completed")
        return Result(version_code=version_code, status="completed")
    except ApiError as error:
        if DRAFT_ONLY not in error.message:
            raise
    release("draft")
    return Result(version_code=version_code, status="draft")


def summary(package, release_name, result):
    """The line the run's summary gets."""
    if result.status == "completed":
        return f"`{package}` {release_name} (version code {result.version_code}) is out to the internal testers."
    return (f"`{package}` {release_name} (version code {result.version_code}) is a **draft** on the internal "
            "track: the app is still a draft in Play Console, which takes only draft releases. Roll it out "
            "there by hand, and finish the app's setup tasks so the next release goes out by itself.")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--package", required=True)
    parser.add_argument("--bundle", required=True, type=pathlib.Path)
    parser.add_argument("--release-name", required=True)
    args = parser.parse_args()

    api = Play(os.environ["GOOGLE_ACCESS_TOKEN"])
    try:
        result = upload(api, args.package, args.bundle.read_bytes(), args.release_name)
    except (FirstUploadByHand, ApiError) as error:
        print(f"::error::{error}")
        return 1
    line = summary(args.package, args.release_name, result)
    if result.status == "draft":
        print(f"::warning::{line}")
    print(line)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as out:
            out.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
