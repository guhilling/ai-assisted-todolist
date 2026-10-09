#!/usr/bin/env python3
"""
Fails when a pushed tag's image index lacks a platform the workflow built it for (#249).

    python3 .github/scripts/check-image-platforms.py quay.io/ghilling/taskfest-backend:1.2.3 \
        linux/amd64,linux/arm64

publish-images.yml and release.yml run it after every push, with the same platform list they
built with, so the two cannot drift apart. A tag that lacks an architecture is a tag a machine of
that architecture pulls and cannot run -- an Apple-silicon Mac without Rosetta, or Graviton.
"""

import json
import subprocess
import sys


def missing(index, platforms):
    """The platforms of the comma-separated list the index does not list, by OS and architecture."""
    listed = {(m.get("platform", {}).get("os"), m.get("platform", {}).get("architecture"))
              for m in index.get("manifests", [])}
    wanted = [p for p in platforms.split(",") if p]
    return [p for p in wanted if tuple(p.split("/")[:2]) not in listed]


def main():
    image, platforms = sys.argv[1], sys.argv[2]
    index = json.loads(subprocess.run(
        ["docker", "buildx", "imagetools", "inspect", image, "--format", "{{json .Manifest}}"],
        check=True, capture_output=True, text=True).stdout)
    lacking = missing(index, platforms)
    if lacking:
        print(f"::error::{image} is not published for {', '.join(lacking)}")
        return 1
    print(f"{image}: published for {platforms}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
