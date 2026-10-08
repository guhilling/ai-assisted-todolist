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

A scenario that opens a second tab -- opening a PDF does -- has a video per tab, and the page's is
the one worth showing: the largest. Each video also gets a poster, so the published page shows what
a video is about before it plays: of four frames spread across it, the one with the most on screen
-- the largest JPEG -- which is the board with its tasks rather than the sign-in page a scenario
starts and ends on. ffmpeg makes it, and a video without one is published all the same.

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
import subprocess
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
                paths = [a["path"] for a in last.get("attachments", []) if a.get("name") == "video" and a.get("path")]
                if paths:
                    found.append(Video(file, spec["title"], last.get("status", "unknown"),
                                       last.get("duration", 0), largest(paths)))
        for child in suite.get("suites", []):
            walk(child, file)

    for suite in report.get("suites", []):
        walk(suite, suite.get("file", ""))
    return found


def largest(paths):
    """The largest of these files that exists -- a scenario's own page rather than a tab it opened."""
    sizes = {path: pathlib.Path(path).stat().st_size for path in paths if pathlib.Path(path).exists()}
    return max(sizes, key=sizes.get) if sizes else paths[0]


def poster_times(duration_s):
    """Where the candidate poster frames are taken: spread across the video, clear of both ends."""
    return [duration_s * fraction for fraction in (0.2, 0.4, 0.6, 0.8)]


def busiest(candidates):
    """Of the candidate frames, the one with the most on screen: the largest JPEG."""
    existing = [path for path in candidates if path.exists()]
    return max(existing, key=lambda path: path.stat().st_size) if existing else None


def ffmpeg_poster(video, image):
    """The busiest of the candidate frames as a JPEG, made with ffmpeg; False when none can be made."""
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        return False
    try:
        duration = float(subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
            check=True, capture_output=True, text=True).stdout.strip())
    except (subprocess.CalledProcessError, ValueError):
        return False
    candidates = []
    for i, at in enumerate(poster_times(duration)):
        candidate = image.with_suffix(f".{i}.jpg")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{at:.2f}", "-i", str(video),
                        "-frames:v", "1", "-q:v", "4", str(candidate)], capture_output=True)
        candidates.append(candidate)
    chosen = busiest(candidates)
    if chosen:
        chosen.replace(image)
    for candidate in candidates:
        candidate.unlink(missing_ok=True)
    return chosen is not None


def stable_name(spec, title):
    """A file name from the spec and the title alone, the same on every run."""
    stem = spec.removesuffix(".ts").removesuffix(".spec")
    words = re.sub(r"[^a-z0-9]+", "-", f"{stem} {title}".lower()).strip("-")
    return f"{words}.webm"


def collect(report_path, out, *, environment, version, run_url, recorded_at, make_poster=ffmpeg_poster):
    """Copies the run's videos to `out` under their stable names, each with a poster where one can be
    made, and `index.json` beside them."""
    out.mkdir(parents=True, exist_ok=True)
    videos = videos_in(json.loads(report_path.read_text(encoding="utf-8")))
    entries = []
    for video in videos:
        name = stable_name(video.spec, video.title)
        shutil.copyfile(video.path, out / name)
        entry = {"spec": video.spec, "title": video.title, "status": video.status,
                 "durationMs": video.duration_ms, "file": name}
        poster = name.removesuffix(".webm") + ".jpg"
        if make_poster(out / name, out / poster):
            entry["poster"] = poster
        entries.append(entry)
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
