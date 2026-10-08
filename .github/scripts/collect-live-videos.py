#!/usr/bin/env python3
"""
Collects the videos of a live signed-in run for the published site.

Run by live-tests.yml after the signed-in scenarios on qa:

    python3 .github/scripts/collect-live-videos.py e2e/live-videos/report.json live-videos \
        --environment qa --version 0.12.0 --run-url https://github.com/.../actions/runs/123

Playwright records one video per scenario into a directory named after the test plus a hash,
which is no name to link to. This copies each one to a name made from its spec and title alone,
so the newest recording of a scenario is always at the same address, and writes `index.json`
beside them: which environment and release were recorded, when, by which run, and each
scenario's title and outcome. pages.yml publishes the newest such directory under `videos/`.

What the videos show is qa's test accounts (`taskfest-test-one@example.com`, `…-two@…`) and their
tasks. Their passwords are typed into a password field, so the video shows dots, and the
live-test job sets new ones on every run anyway.
"""

import argparse
import dataclasses
import json
import pathlib
import re
import shutil
import sys


@dataclasses.dataclass
class Video:
    """One scenario's recording, as the report names it."""
    spec: str
    title: str
    status: str
    duration_ms: int
    path: str


def videos_in(report):
    """Every scenario in the report that recorded a video, in report order; its last attempt's."""
    found = []

    def walk(suite, file):
        file = suite.get("file", file)
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                results = test.get("results", [])
                if not results:
                    continue
                last = results[-1]
                video = next((a for a in last.get("attachments", []) if a.get("name") == "video" and a.get("path")),
                             None)
                if video:
                    found.append(Video(file, spec["title"], last.get("status", "unknown"),
                                       last.get("duration", 0), video["path"]))
        for child in suite.get("suites", []):
            walk(child, file)

    for suite in report.get("suites", []):
        walk(suite, suite.get("file", ""))
    return found


def stable_name(spec, title):
    """A file name from the spec and the title alone, the same on every run."""
    stem = spec.removesuffix(".ts").removesuffix(".spec")
    words = re.sub(r"[^a-z0-9]+", "-", f"{stem} {title}".lower()).strip("-")
    return f"{words}.webm"


def collect(report_path, out, *, environment, version, run_url, recorded_at):
    """Copies the run's videos to `out` under their stable names, with `index.json` beside them."""
    out.mkdir(parents=True, exist_ok=True)
    videos = videos_in(json.loads(report_path.read_text(encoding="utf-8")))
    entries = []
    for video in videos:
        name = stable_name(video.spec, video.title)
        shutil.copyfile(video.path, out / name)
        entries.append({"spec": video.spec, "title": video.title, "status": video.status,
                        "durationMs": video.duration_ms, "file": name})
    index = {"environment": environment, "version": version, "recordedAt": recorded_at, "runUrl": run_url,
             "videos": entries}
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=pathlib.Path)
    parser.add_argument("out", type=pathlib.Path)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--run-url", required=True)
    parser.add_argument("--recorded-at", required=True)
    args = parser.parse_args()
    if not args.report.exists():
        print(f"No report at {args.report}: nothing was recorded.")
        return 0
    entries = collect(args.report, args.out, environment=args.environment, version=args.version,
                      run_url=args.run_url, recorded_at=args.recorded_at)
    print(f"Collected {len(entries)} video(s) into {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
