#!/usr/bin/env python3
"""
Generates the project's SVG artwork: the README's diagrams, and the logo -- with the website's
favicon and sign-in icon, and the sources of the app's icons.

Run it after changing anything a diagram claims, or the mark:

    python3 doc/images/generate.py

Why generated rather than hand-drawn: each diagram needs a light and a dark variant, and
keeping two nearly-identical SVGs in step by hand is precisely the kind of edit that gets
half-done. Here the geometry is written once and the palette is a parameter.

Why files rather than inline SVG: a README is markdown rendered by GitHub, which embeds
images through `<img>`. An embedded SVG has no page foreground to inherit, so `currentColor`
resolves to nothing useful and a `<style>` block with a `prefers-color-scheme` query is
stripped by GitHub's sanitiser. Two files behind a `<picture>` element is the arrangement
that actually works.
"""
from __future__ import annotations

import pathlib
import re
from dataclasses import dataclass

HERE = pathlib.Path(__file__).parent


@dataclass(frozen=True)
class Palette:
    """One colour scheme. `accent` is reserved for the single claim each diagram makes; `aws` and
    `external` mark, in the architecture, what runs as an AWS service and what is someone else's."""

    name: str
    bg: str
    surface: str
    border: str
    text: str
    muted: str
    accent: str
    accent_soft: str
    aws: str
    aws_soft: str
    external: str
    external_soft: str


LIGHT = Palette(
    name="light",
    bg="#ffffff",
    surface="#f6f8fa",
    border="#d5dbe1",
    text="#1a1f24",
    muted="#5b6672",
    accent="#1a73e8",
    accent_soft="#e8f0fe",
    aws="#e8913a",
    aws_soft="#fff1e3",
    external="#34a853",
    external_soft="#e6f4ea",
)

DARK = Palette(
    name="dark",
    bg="#14181c",
    surface="#1e242a",
    border="#39424b",
    text="#e6eaee",
    muted="#9aa5b1",
    accent="#8ab4f8",
    accent_soft="#1f2b3d",
    aws="#f6ad55",
    aws_soft="#3a2a17",
    external="#81c995",
    external_soft="#1c3326",
)

FONT = (
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "Helvetica, Arial, sans-serif"
)


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def box(x, y, w, h, lines, p: Palette, *, accent=False, tint=None, dashed=False, radius=10):
    """A labelled rectangle. `lines` is a list; the first is the name, the rest are detail.
    `tint` colours it as one of a kind: "aws" or "external"."""
    fill = p.accent_soft if accent else p.surface
    stroke = p.accent if accent else p.border
    if tint:
        fill, stroke = getattr(p, f"{tint}_soft"), getattr(p, tint)
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"{dash}/>'
    ]
    cx = x + w / 2
    # Vertically centre the block of lines: 19px apart, first line 6px above centre.
    total = 19 * (len(lines) - 1)
    first = y + h / 2 - total / 2 + 5
    for i, line in enumerate(lines):
        colour = p.text if i == 0 else p.muted
        weight = "600" if i == 0 else "400"
        size = 13 if i == 0 else 11.5
        out.append(
            f'<text x="{cx}" y="{first + 19 * i}" text-anchor="middle" '
            f'font-size="{size}" font-weight="{weight}" fill="{colour}">{esc(line)}</text>'
        )
    return "\n  ".join(out)


def arrow(points, p: Palette, *, accent=False, dashed=False, marker="arrow", both=False):
    """A polyline with an arrowhead at the end, and with `both` at the start too.
    `points` is [(x, y), ...]."""
    colour = p.accent if accent else p.muted
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    path = " ".join(f"{x},{y}" for x, y in points)
    suffix = "-accent" if accent else ""
    start = f' marker-start="url(#{marker}{suffix})"' if both else ""
    return (
        f'<polyline points="{path}" fill="none" stroke="{colour}" stroke-width="1.6"'
        f'{dash}{start} marker-end="url(#{marker}{suffix})"/>'
    )


def rule(x1, x2, y, p: Palette, *, accent=False):
    """A horizontal dashed divider. Not an arrow: it separates rather than points."""
    colour = p.accent if accent else p.border
    return (
        f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{colour}" '
        f'stroke-width="1.6" stroke-dasharray="6 5"/>'
    )


def label(x, y, text, p: Palette, *, anchor="middle", accent=False, size=11.5):
    colour = p.accent if accent else p.muted
    return (
        f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" '
        f'fill="{colour}">{esc(text)}</text>'
    )


def document(width, height, body, p: Palette, aria: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"
     width="{width}" height="{height}" role="img" aria-label="{esc(aria)}"
     font-family="{FONT}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"
            markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="{p.muted}"/>
    </marker>
    <marker id="arrow-accent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"
            markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="{p.accent}"/>
    </marker>
  </defs>
  <rect width="{width}" height="{height}" fill="{p.bg}"/>
  {body}
</svg>
"""


def architecture(p: Palette) -> str:
    """The Go backend on Lambda (#547), top to bottom: how a request travels, where the tokens
    stop, how files bypass the backend, what runs in the background, and how it is watched. Drawn
    upright, so that GitHub's README column shows it whole at a readable size."""
    w, h = 840, 1300
    main_x, main_w = 40, 420
    left_w, right_x = 200, 260  # the main column, split in two
    side_x, side_w = 520, 280
    # Where vertical arrows run: the centre of the main column and of its two halves, and their
    # labels a little to the right of them.
    lc, rc, mc = main_x + left_w / 2, right_x + left_w / 2, main_x + main_w / 2
    sc = side_x + side_w / 2
    gap = 12

    def down(x, y1, y2, text=None, **kw):
        out = [arrow([(x, y1), (x, y2)], p, **kw)]
        if text:
            out.append(label(x + gap, (y1 + y2) / 2 + 4, text, p, anchor="start", size=11))
        return out

    parts = [
        # Ours in blue, AWS services in orange, someone else's in green.
        box(main_x, 50, left_w, 64, ["Browser", "the SPA"], p, accent=True),
        # The iOS and the Android app work alike, so they are one box with another behind it.
        box(right_x + gap, 38, left_w, 64, [], p, accent=True),
        box(right_x, 50, left_w, 64, ["iOS and Android apps", "one Expo codebase"], p, accent=True),
        box(side_x, 50, side_w, 64, ["Identity provider", "Google"], p, tint="external"),
        # The apps sign in themselves; the browser is only ever redirected there.
        arrow([(right_x + left_w + gap, 82), (side_x, 82)], p),
        label((right_x + left_w + gap + side_x) / 2, 74, "sign in", p),
        arrow([(lc, 50), (lc, 22), (sc, 22), (sc, 50)], p),
        label((lc + sc) / 2, 16, "the browser is redirected to sign in", p),

        box(main_x, 170, main_w, 64, ["CloudFront", "the site's files, and /api"], p, tint="aws"),
        box(side_x, 170, side_w, 64, ["S3", "the site's files"], p, tint="aws"),
        arrow([(lc, 114), (lc, 170)], p),
        # The claim the backend-for-frontend exists for.
        label(lc + 10, 136, "same origin, a session cookie:", p, anchor="start", accent=True,
              size=12),
        label(lc + 10, 152, "the browser never holds a token", p, anchor="start", accent=True,
              size=12),
        arrow([(rc, 114), (rc, 170)], p),
        label(rc + gap, 136, "ID token", p, anchor="start", size=11),
        label(rc + gap, 151, "as Bearer", p, anchor="start", size=11),
        arrow([(main_x + main_w, 202), (side_x, 202)], p),

        box(main_x, 300, main_w, 64, ["API Gateway, HTTP API", "with CloudFront's secret header"], p,
            tint="aws"),
        *down(mc, 234, 300, "/api"),

        box(main_x, 420, main_w, 80,
            ["api \u00b7 Go on Lambda", "every route; the OIDC client, which",
             "exchanges the code with Google itself"], p, accent=True),
        *down(mc, 364, 420, "invokes its alias live"),

        box(main_x, 560, left_w, 64, ["S3", "attachments \u00b7 serverless/"], p, tint="aws"),
        box(right_x, 560, left_w, 64, ["DynamoDB", "one table \u00b7 TTL \u00b7 stream"], p,
            tint="aws"),
        *down(lc, 500, 560, "signs links"),
        *down(rc, 500, 560, "reads, writes"),
        # Attachments (#204): the content goes both ways straight between the clients and S3.
        arrow([(main_x, 98), (20, 98), (20, 600), (main_x, 600)], p, accent=True, both=True),
        label(main_x, 646, "files, both ways: presigned PUT and GET, straight", p, anchor="start",
              accent=True, size=12),
        label(main_x, 662, "from the browser and the apps alike", p, anchor="start", accent=True,
              size=12),

        box(main_x, 700, left_w, 64, ["orphans \u00b7 replay", "on EventBridge Scheduler"], p,
            accent=True),
        box(right_x, 700, left_w, 64, ["streams", "deletes the files of what goes"], p,
            accent=True),
        *down(rc, 624, 700, "stream"),

        # How it is watched (#558, #508).
        label(main_x, 816, "Watching it", p, anchor="start", size=13),
        rule(140, side_x + side_w, 811, p),
        label(side_x, 744, "Every function, api included, and", p, anchor="start", size=11),
        label(side_x, 760, "the HTTP API report metrics and", p, anchor="start", size=11),
        label(side_x, 776, "write their log lines below.", p, anchor="start", size=11),
        box(main_x, 860, left_w, 64, ["CloudWatch Logs", "every function, the access log"], p,
            tint="aws"),
        box(right_x, 860, left_w, 64, ["CloudWatch metrics", "Lambda \u00b7 HTTP API \u00b7 table"],
            p, tint="aws"),
        box(side_x, 860, side_w, 64, ["CloudWatch dashboard", "taskfest-<env>-go-backend"], p,
            tint="aws"),
        *down(lc, 764, 860, "log lines"),
        *down(rc, 764, 860, "metrics"),
        arrow([(right_x + left_w, 892), (side_x, 892)], p),
        label((right_x + left_w + side_x) / 2, 884, "draws", p, size=11),

        box(main_x, 980, left_w, 64, ["logship", "Go on Lambda \u00b7 qa"], p, accent=True),
        box(right_x, 980, left_w, 64, ["10 alarms", "9 on metrics, 1 on a log line"], p, tint="aws"),
        *down(lc - 50, 924, 980, None),
        label(lc - 38, 956, "subscription", p, anchor="start", size=11),
        arrow([(rc, 924), (rc, 980)], p),
        # The orphan alert counts a log line, through a metric filter (alerting.tf).
        arrow([(lc + 50, 924), (lc + 50, 952), (rc - 50, 952), (rc - 50, 980)], p),
        label(lc + 60, 946, "metric filter", p, anchor="start", size=11),

        box(main_x, 1100, left_w, 64, ["VictoriaLogs \u00b7 Perses", "a Hetzner VM, shared"], p,
            tint="external"),
        box(right_x, 1100, left_w, 64, ["SNS", "taskfest-<env>-alerts"], p, tint="aws"),
        *down(lc, 1044, 1100, "HTTPS, basic auth"),
        arrow([(rc, 1044), (rc, 1100)], p),

        box(right_x, 1220, left_w, 56, ["Gunnar", "by mail"], p),
        arrow([(rc, 1164), (rc, 1220)], p),
        arrow([(right_x, 1248), (lc, 1248), (lc, 1164)], p),
        label(lc + gap, 1204, "the dashboards,", p, anchor="start", size=11),
        label(lc + gap, 1220, "through SSH", p, anchor="start", size=11),
    ]
    aria = (
        "TaskFest on the Go backend, top to bottom. The browser and the iOS and Android apps sign "
        "in with Google: the browser is redirected there, the apps sign in themselves. Both talk "
        "only to CloudFront, which serves the site's files from S3 and passes /api to API "
        "Gateway's HTTP API with a secret header. The HTTP API invokes the "
        "api function, Go on Lambda, which serves every route and is the OIDC client: it "
        "exchanges the code with Google itself, and the browser holds a session cookie, never a "
        "token, while the apps send their ID token as a Bearer token. The api function reads and "
        "writes one DynamoDB table and signs links to the attachment bucket, so files go both "
        "ways straight between the clients and S3. The table's stream feeds the streams "
        "function, and EventBridge Scheduler runs orphans and replay. Every function and the "
        "HTTP API report metrics to CloudWatch, which a CloudWatch dashboard draws, and write "
        "their log lines to CloudWatch Logs. Ten alarms, nine on the metrics and one on the "
        "orphan clean-up's log line through a metric filter, notify an SNS topic, which mails "
        "Gunnar. In qa, a subscription filter also hands every log line to logship, which sends "
        "it over HTTPS with basic auth to VictoriaLogs and Perses on a shared Hetzner VM, which "
        "Gunnar opens through SSH."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


def architecture_containers(p: Palette) -> str:
    """The containers' architecture, Quarkus on Fargate with PostgreSQL, which served TaskFest
    until the port (#547): kept as the reference architecture.md compares the
    Go backend with. How a request travels, where the tokens stop, and how files bypass the
    backend."""
    w, h = 1000, 500
    row_y, box_h = 190, 72
    bottom = row_y + box_h

    parts = [
        # Ours in blue, AWS services in orange, someone else's in green.
        box(30, row_y, 150, box_h, ["Browser", "the SPA"], p, accent=True),
        # The iOS and the Android app work alike, so they are one box with another behind it.
        box(282, 32, 170, 64, [], p, accent=True),
        box(270, 44, 170, 64, ["iOS and Android apps", "one Expo codebase"], p, accent=True),
        box(270, row_y, 170, box_h, ["CloudFront", "static files + /api"], p, tint="aws"),
        box(530, row_y, 190, box_h, ["Quarkus backend", "the OIDC client"], p, accent=True),
        box(810, row_y, 160, box_h, ["PostgreSQL", "RDS \u00b7 Liquibase"], p, tint="aws"),
        box(530, 40, 190, 64, ["Identity provider", "Google"], p, tint="external"),
        box(810, 400, 160, 72, ["Object storage", "S3 \u00b7 attachments"], p, tint="aws"),

        # The straight left-to-right path. Gaps are 90px so the labels sit clear of the boxes.
        arrow([(180, 226), (270, 226)], p),
        label(225, 216, "same origin", p),
        arrow([(440, 226), (530, 226)], p),
        label(485, 216, "/api", p),
        arrow([(720, 226), (810, 226)], p),
        label(765, 216, "SQL", p),
        label(890, 292, "every query carries", p, size=11),
        label(890, 307, "an owner predicate", p, size=11),

        # The backend talks to the provider itself; the browser is only ever redirected.
        arrow([(625, row_y), (625, 104)], p),
        label(640, 148, "code exchange,", p, anchor="start", size=11),
        label(640, 163, "server to server", p, anchor="start", size=11),
        arrow([(105, row_y), (105, 16), (580, 16), (580, 40)], p),
        label(187, 34, "redirected to sign in", p),

        # The apps sign in themselves and send the ID token they got; the cookie is the browser's.
        arrow([(440, 76), (530, 76)], p),
        label(485, 66, "sign in", p),
        arrow([(355, 108), (355, row_y)], p),
        label(367, 145, "/api, with the", p, anchor="start", size=11),
        label(367, 160, "ID token as Bearer", p, anchor="start", size=11),

        # The claim this picture exists to make, routed clear of the row above it.
        arrow([(625, bottom), (625, 312), (105, 312), (105, bottom)], p, accent=True),
        label(365, 334, "encrypted session cookie", p, accent=True, size=12),
        label(365, 352, "the browser never holds a token", p, accent=True, size=12),

        # Attachments (#204): the backend only signs links and looks after the objects; the
        # content goes straight between the browser and S3, so it never passes through it.
        arrow([(700, bottom), (700, 418), (810, 418)], p),
        label(712, 372, "signs links, checks,", p, anchor="start", size=11),
        label(712, 387, "deletes", p, anchor="start", size=11),
        arrow([(55, bottom), (55, 454), (810, 454)], p, accent=True),
        label(380, 444, "files, straight from the browser and the apps: presigned PUT and GET", p,
              accent=True, size=12),
        label(380, 476, "file content never passes through the backend", p, accent=True, size=12),
    ]
    aria = (
        "The browser talks only to CloudFront, which serves the app from S3 and passes /api to "
        "the Quarkus backend. The backend is the OIDC client: it exchanges the code with the "
        "identity provider, Google, itself and returns an encrypted session cookie, so the browser "
        "never holds a token. The iOS and Android apps sign in with the identity provider "
        "themselves and send their /api requests through CloudFront too, with the ID token as a "
        "Bearer token. The database is PostgreSQL on RDS. Files attached to tasks go straight "
        "between the browser or the apps and S3 through presigned links the backend signs, so "
        "their content never passes through it."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


def identities(p: Palette) -> str:
    """Who may do what to AWS, and where the line between a person and automation falls."""
    w, h = 1020, 470
    left_x, left_w = 40, 250
    right_x, right_w = 470, 510
    box_h = 90
    rows = (40, 200, 340)
    line_y = 160

    parts = [
        box(left_x, rows[0], left_w, box_h,
            ["gunnar", "IAM admin user \u00b7 MFA", "not the account root user"], p),
        box(right_x, rows[0], right_w, box_h,
            ["Everything, by an apply",
             "table \u00b7 buckets \u00b7 functions \u00b7 HTTP API \u00b7 distribution",
             "IAM \u00b7 ACM certificate \u00b7 Route 53 records"], p),
        arrow([(left_x + left_w, rows[0] + box_h / 2), (right_x, rows[0] + box_h / 2)], p),
        label(380, rows[0] + box_h / 2 - 10, "creates \u00b7 changes", p),

        # The claim: the only identity that runs unattended is the one that cannot create
        # anything. Every change to infrastructure needs a person.
        rule(30, 990, line_y, p, accent=True),
        label(34, line_y - 10, "above \u2014 a person at a terminal", p, anchor="start"),
        label(34, line_y + 22,
              "below \u2014 unattended, and cannot create, change or delete infrastructure", p,
              anchor="start", accent=True, size=12),

        box(left_x, rows[1], left_w, box_h,
            ["taskfest-<env>-deploy", "GitHub Actions, via OIDC", "no stored credential"], p,
            accent=True),
        box(right_x, rows[1], right_w, box_h,
            ["Redeploy only",
             "the Go backend's code \u00b7 its alias live",
             "frontend artifact \u2192 site bucket"], p),
        arrow([(left_x + left_w, rows[1] + box_h / 2), (right_x, rows[1] + box_h / 2)], p,
              accent=True),
        label(380, rows[1] + box_h / 2 - 10, "updates", p, accent=True),

        box(left_x, rows[2], left_w, 84,
            ["taskfest-monitoring", "read-only, everywhere", "a person at a console"], p),
        box(right_x, rows[2], right_w, 84,
            ["taskfest-<env>-api \u00b7 -streams \u00b7 -orphans \u00b7 \u2026",
             "what the functions run as \u2014 nobody assumes these",
             "each may make only the calls its function makes"], p),
    ]
    aria = (
        "Two identities, in order of how much they may do. A human IAM admin creates and changes "
        "everything by an apply: the table, the buckets, the functions, the HTTP API, the "
        "distribution, IAM, the certificate and the DNS records. Below the line, the only "
        "unattended identity is the deploy role, assumed from GitHub Actions through OIDC, which "
        "may deploy the Go backend's code and the site bucket and cannot create, change or delete "
        "any infrastructure. Separately, the function roles are what the Go backend's functions "
        "run as rather than an identity anyone assumes. A read-only user exists for looking at "
        "things."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


def workflow(p: Palette) -> str:
    """What every change passes through, and what a release leaves to watch."""
    w, h = 1090, 520
    row_y, box_h = 172, 56
    gates = [
        "gofmt, go vet, oxlint",
        "Tests, frontend coverage gate",
        "Contract checks",
        "CodeQL",
        "End-to-end in a browser",
    ]
    gate_h, gap, pill_x, pill_w = 34, 12, 675, 210
    stack_h = len(gates) * gate_h + (len(gates) - 1) * gap
    panel_x, panel_w = 660, 240
    panel_h = stack_h + 70
    panel_y = 200 - panel_h / 2
    pill_top = panel_y + 52

    parts = [
        box(20, row_y, 150, box_h, ["Ask, don't guess"], p),
        box(210, row_y, 150, box_h, ["Failing test first"], p),
        box(400, row_y, 170, box_h, ["Change + docs", "in one commit"], p),
        box(950, row_y, 110, box_h, ["main"], p, accent=True),

        arrow([(170, 200), (210, 200)], p),
        arrow([(360, 200), (400, 200)], p),

        # The gates are one thing a change passes through, so they get one container and
        # one arrow in. Arrowing into the middle pill would say it faced only that check.
        f'<rect x="{panel_x}" y="{panel_y}" width="{panel_w}" height="{panel_h}" rx="12" '
        f'fill="none" stroke="{p.border}" stroke-width="1.5"/>',
        label(panel_x + panel_w / 2, panel_y + 26, "Every check must pass", p, size=12),

        arrow([(570, 200), (panel_x, 200)], p),
        label(615, 190, "pull request", p, size=11),
        arrow([(panel_x + panel_w, 200), (950, 200)], p, accent=True),
        label(925, 190, "squash", p, accent=True, size=11),
        # SonarCloud runs after the merge, on main only; a failed gate becomes an issue.
        label(1005, 160, "SonarCloud gate \u2192 issue", p, size=11),
    ]

    for i, name in enumerate(gates):
        y = pill_top + i * (gate_h + gap)
        parts.append(box(pill_x, y, pill_w, gate_h, [name], p, radius=8))

    parts += [
        # The loop closes: nobody starts the next change by hand.
        arrow([(1005, 228), (1005, 372), (95, 372), (95, 228)], p),
        label(550, 392, "Renovate opens the next change", p),

        # A release, from main: deployed to qa, tested there from outside, and recorded. The
        # newest run's videos are what the documentation site shows of the running app.
        arrow([(1040, 228), (1040, 440)], p),
        box(950, 440, 110, 52, ["git tag", "a release"], p),
        arrow([(950, 466), (910, 466)], p),
        box(750, 440, 160, 52, ["Deploy to qa"], p),
        arrow([(750, 466), (710, 466)], p),
        box(510, 440, 200, 52, ["Live tests on qa", "website and app, recorded"], p),
        arrow([(510, 466), (470, 466)], p),
        box(270, 440, 200, 52, ["Videos", "on the documentation site"], p),
    ]
    aria = (
        "Every change starts from a question rather than a guess, then a failing test, then "
        "the change and its documentation in one commit. A pull request must pass gofmt, go vet "
        "and oxlint, the tests and the frontend's coverage gate, the contract checks, CodeQL, "
        "and the browser end-to-end run before it is squashed onto main. SonarCloud then analyses main, and a "
        "failed quality gate becomes a GitHub issue. A git tag on main "
        "cuts a release, which is deployed to qa and tested there from outside, the website's "
        "scenarios and the app's flows each recorded; the newest run's videos are published on "
        "the documentation site."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


# The mark: a panda's head on a mint tile, its right ear a green disc with a check mark (Gunnar's
# pick, "D", 2026-10-10). It abstracts the panda of the paused page (`paused-panda.svg`) -- same
# ink, same mint -- and keeps the old mark's point that a task done is a tick. It brings its own
# background, so it reads the same on a light page and a dark one, and needs no colour variants:
# `logo-light.svg` and `logo-dark.svg` stay two files only because the README and the
# documentation site choose between them with `<picture>`.
#
# The geometry is written once, in a 128-unit square, and every file below draws it: the logo,
# the favicons, the sign-in button's icon, and the app's icons, which differ only in how much
# room they leave round it.
LOGO_VIEWBOX = 128
INK = "#1d1d1f"
MINT = "#e9f5e1"
LEAF = "#7fae1c"
# The check mark, inside the green disc that stands in for the right ear.
LOGO_CHECK = "M 87 34 L 93.5 41 L 106 27"
ARIA_LOGO = "A panda's head on a mint tile, its right ear a green disc with a check mark"


def panda() -> str:
    """The panda and its badge, in the 128-unit square, without a tile behind them."""
    return f"""<circle cx="34" cy="36" r="13" fill="{INK}"/>
  <circle cx="64" cy="72" r="40" fill="#ffffff" stroke="{INK}" stroke-width="6"/>
  <ellipse cx="49" cy="72" rx="8.5" ry="12" transform="rotate(-32 49 72)" fill="{INK}"/>
  <ellipse cx="79" cy="72" rx="8.5" ry="12" transform="rotate(32 79 72)" fill="{INK}"/>
  <circle cx="51" cy="70" r="3.5" fill="#ffffff"/>
  <circle cx="77" cy="70" r="3.5" fill="#ffffff"/>
  <ellipse cx="64" cy="88" rx="6" ry="4.5" fill="{INK}"/>
  <circle cx="96" cy="34" r="19" fill="{LEAF}" stroke="{MINT}" stroke-width="5"/>
  <path d="{LOGO_CHECK}" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>"""


def logo() -> str:
    """The mark on its rounded tile: the logo, the favicon and the sign-in button's icon."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LOGO_VIEWBOX} {LOGO_VIEWBOX}"
     width="{LOGO_VIEWBOX}" height="{LOGO_VIEWBOX}" role="img" aria-label="{ARIA_LOGO}">
  <rect width="{LOGO_VIEWBOX}" height="{LOGO_VIEWBOX}" rx="28" fill="{MINT}"/>
  {panda()}
</svg>
"""


# The app's icons (#264), as the sources `mobile/assets/render-icons.sh` turns into the PNGs Expo
# takes. Each platform rounds or crops the icon itself, so none of them has the tile's corners.

def app_icon() -> str:
    """iOS and the fallback icon: full-bleed mint, the panda a little smaller, clear of the corners
    iOS cuts away."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LOGO_VIEWBOX} {LOGO_VIEWBOX}">
  <rect width="{LOGO_VIEWBOX}" height="{LOGO_VIEWBOX}" fill="{MINT}"/>
  <g transform="translate(64 64) scale(0.84) translate(-66 -64)">
  {panda()}
  </g>
</svg>
"""


# Android's adaptive icon is 108 units square, and only a circle 66 across at its centre is sure to
# show whatever shape the launcher cuts. The panda and its badge reach about 63 units from their
# centre (69, 65), so they are scaled to fit inside that circle.
ADAPTIVE = 108
ADAPTIVE_FIT = "translate(54 54) scale(0.52) translate(-69 -65)"


def android_foreground() -> str:
    """The adaptive icon's foreground: the panda alone, on nothing."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ADAPTIVE} {ADAPTIVE}">
  <g transform="{ADAPTIVE_FIT}">
  {panda()}
  </g>
</svg>
"""


def android_background() -> str:
    """The adaptive icon's background: the tile's mint, all over."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ADAPTIVE} {ADAPTIVE}">
  <rect width="{ADAPTIVE}" height="{ADAPTIVE}" fill="{MINT}"/>
</svg>
"""


def android_monochrome() -> str:
    """
    The themed icon Android 13 tints with the wallpaper's colours: one colour, read only by its
    alpha. The white of the head is left out, and the eyes and the check mark are cut out of their
    patches and badge, so the drawing still reads in a single colour.
    """
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ADAPTIVE} {ADAPTIVE}">
  <defs>
    <mask id="cut">
      <rect x="-200" y="-200" width="600" height="600" fill="#ffffff"/>
      <circle cx="51" cy="70" r="3.5" fill="#000000"/>
      <circle cx="77" cy="70" r="3.5" fill="#000000"/>
      <path d="{LOGO_CHECK}" fill="none" stroke="#000000" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    </mask>
  </defs>
  <g transform="{ADAPTIVE_FIT}">
    <g fill="{INK}" mask="url(#cut)">
      <circle cx="34" cy="36" r="13"/>
      <circle cx="64" cy="72" r="40" fill="none" stroke="{INK}" stroke-width="6"/>
      <ellipse cx="49" cy="72" rx="8.5" ry="12" transform="rotate(-32 49 72)"/>
      <ellipse cx="79" cy="72" rx="8.5" ry="12" transform="rotate(32 79 72)"/>
      <ellipse cx="64" cy="88" rx="6" ry="4.5"/>
      <circle cx="96" cy="34" r="19"/>
    </g>
  </g>
</svg>
"""


def notification_icon() -> str:
    """
    Android's status-bar icon for the reminders (#273): like the themed icon, one colour read only
    by its alpha -- white, as Android asks -- but filling its square, since the status bar shows it
    at 24 pixels with nothing cropped.
    """
    return android_monochrome().replace(f'viewBox="0 0 {ADAPTIVE} {ADAPTIVE}"', 'viewBox="0 0 128 128"').replace(
        ADAPTIVE_FIT, "translate(64 64) scale(0.98) translate(-69 -65)"
    ).replace(f'fill="{INK}"', 'fill="#ffffff"').replace(f'stroke="{INK}"', 'stroke="#ffffff"')


# "TaskFest" in Quicksand Bold, as an outline, 1000 units to the em and 4218 wide, baseline at 0:
# rsvg-convert has only the fonts installed, and Quicksand is not. Cut with fonttools from
# mobile/assets/fonts/Quicksand-Bold.ttf, kerning included.
WORDMARK_WIDTH = 4218
WORDMARK = (
    "M596 -642Q596 -616 579 -600Q562 -585 535 -585H378V-61Q378 -35 359 -18Q340 0 312 0"
    "Q284 0 266 -18Q248 -35 248 -61V-585H91Q64 -585 47 -601Q30 -617 30 -643Q30 -668 48 -684"
    "Q65 -700 91 -700H535Q562 -700 579 -684Q596 -668 596 -642ZM1084 -484V-61Q1084 -35 1067 -18"
    "Q1050 0 1024 0Q998 0 982 -17Q965 -34 964 -60Q939 -31 896 -10Q854 10 807 10Q738 10 682 -26"
    "Q626 -61 594 -124Q561 -187 561 -267Q561 -347 593 -410Q625 -474 680 -510Q736 -545 803 -545"
    "Q851 -545 893 -528Q935 -510 964 -483V-484Q964 -510 981 -528Q998 -545 1024 -545"
    "Q1050 -545 1067 -528Q1084 -511 1084 -484ZM969 -267Q969 -339 928 -387Q887 -435 822 -435"
    "Q758 -435 717 -387Q676 -339 676 -267Q676 -195 716 -148Q757 -100 822 -100Q887 -100 928 -148"
    "Q969 -195 969 -267ZM1174 -113Q1174 -139 1200 -157Q1214 -166 1229 -166Q1250 -166 1269 -147"
    "Q1299 -116 1332 -101Q1364 -86 1410 -86Q1488 -89 1488 -145Q1488 -174 1462 -189"
    "Q1435 -204 1379 -219Q1321 -235 1284 -251Q1248 -267 1222 -300Q1195 -332 1195 -387"
    "Q1195 -435 1222 -470Q1250 -506 1294 -526Q1339 -545 1389 -545Q1440 -545 1491 -526"
    "Q1542 -507 1571 -470Q1584 -454 1584 -434Q1584 -411 1565 -396Q1551 -385 1533 -385"
    "Q1511 -385 1497 -399Q1479 -421 1450 -434Q1422 -447 1386 -447Q1310 -447 1310 -392"
    "Q1310 -370 1324 -356Q1338 -343 1360 -336Q1381 -328 1420 -317Q1474 -302 1510 -286"
    "Q1546 -270 1571 -237Q1596 -204 1596 -150Q1596 -101 1567 -64Q1538 -28 1492 -9Q1447 10 1399 10"
    "Q1333 10 1276 -12Q1219 -34 1183 -83Q1174 -95 1174 -113ZM2160 -60Q2160 -35 2140 -18"
    "Q2121 -1 2099 -1Q2073 -1 2055 -21L1875 -211L1826 -166V-61Q1826 -35 1809 -18Q1792 0 1766 0"
    "Q1740 0 1723 -18Q1706 -35 1706 -61V-679Q1706 -705 1723 -722Q1740 -740 1766 -740"
    "Q1792 -740 1809 -722Q1826 -705 1826 -679V-309L2040 -516Q2059 -535 2084 -535"
    "Q2106 -535 2124 -516Q2141 -498 2141 -479Q2141 -455 2117 -434L1966 -295L2141 -105"
    "Q2160 -85 2160 -60ZM2400 -585V-409H2616Q2642 -409 2660 -392Q2677 -376 2677 -350"
    "Q2677 -328 2660 -311Q2642 -294 2616 -294H2400V-61Q2400 -35 2382 -18Q2363 0 2338 0"
    "Q2310 0 2292 -17Q2275 -34 2275 -61V-639Q2275 -665 2292 -682Q2310 -700 2336 -700H2661"
    "Q2687 -700 2704 -684Q2722 -667 2722 -641Q2722 -619 2704 -602Q2687 -585 2661 -585ZM3231 -226"
    "H2901Q2913 -167 2956 -134Q2999 -100 3053 -100Q3094 -100 3117 -108Q3140 -115 3154 -124"
    "Q3167 -132 3172 -135Q3190 -144 3206 -144Q3227 -144 3242 -129Q3257 -114 3257 -94"
    "Q3257 -67 3229 -45Q3201 -22 3154 -6Q3107 10 3059 10Q2975 10 2912 -25Q2850 -60 2816 -122"
    "Q2782 -183 2782 -260Q2782 -346 2818 -411Q2854 -476 2913 -510Q2972 -545 3039 -545"
    "Q3105 -545 3164 -509Q3222 -473 3257 -412Q3292 -351 3292 -280Q3291 -256 3273 -241"
    "Q3255 -226 3231 -226ZM2902 -326H3164V-333Q3160 -375 3123 -405Q3086 -435 3039 -435"
    "Q2923 -435 2902 -326ZM3352 -113Q3352 -139 3378 -157Q3392 -166 3407 -166Q3428 -166 3447 -147"
    "Q3477 -116 3510 -101Q3542 -86 3588 -86Q3666 -89 3666 -145Q3666 -174 3640 -189"
    "Q3613 -204 3557 -219Q3499 -235 3462 -251Q3426 -267 3400 -300Q3373 -332 3373 -387"
    "Q3373 -435 3400 -470Q3428 -506 3472 -526Q3517 -545 3567 -545Q3618 -545 3669 -526"
    "Q3720 -507 3749 -470Q3762 -454 3762 -434Q3762 -411 3743 -396Q3729 -385 3711 -385"
    "Q3689 -385 3675 -399Q3657 -421 3628 -434Q3600 -447 3564 -447Q3488 -447 3488 -392"
    "Q3488 -370 3502 -356Q3516 -343 3538 -336Q3559 -328 3598 -317Q3652 -302 3688 -286"
    "Q3724 -270 3749 -237Q3774 -204 3774 -150Q3774 -101 3745 -64Q3716 -28 3670 -9Q3625 10 3577 10"
    "Q3511 10 3454 -12Q3397 -34 3361 -83Q3352 -95 3352 -113ZM4169 -64Q4169 -37 4140 -18"
    "Q4110 0 4073 0Q4011 0 3968 -26Q3926 -53 3926 -139V-415H3880Q3856 -415 3840 -431"
    "Q3824 -447 3824 -471Q3824 -494 3840 -510Q3856 -525 3880 -525H3926V-589Q3926 -615 3944 -632"
    "Q3961 -650 3987 -650Q4012 -650 4029 -632Q4046 -615 4046 -589V-525H4117Q4141 -525 4157 -509"
    "Q4173 -493 4173 -469Q4173 -446 4157 -430Q4141 -415 4117 -415H4046V-144Q4046 -123 4057 -114"
    "Q4068 -104 4087 -104Q4095 -104 4109 -108Q4121 -113 4132 -113Q4146 -113 4158 -100"
    "Q4169 -86 4169 -64Z"
)

# Play's feature graphic, for both listings' languages: the name is its only text.
FEATURE_WIDTH, FEATURE_HEIGHT = 1024, 500
# --brand-strong in frontend/src/App.css, the app's title too.
BRAND_STRONG = "#58791d"


def feature_task(y: int, width: int, done: bool) -> str:
    """One line of the feature graphic's task list: its circle, ticked or not, and its text."""
    if done:
        circle = (f'<circle cx="640" cy="{y}" r="22" fill="{LEAF}"/>'
                  f'<path d="M 630 {y} l 7 8 l 14 -16" fill="none" stroke="#ffffff" stroke-width="6" '
                  'stroke-linecap="round" stroke-linejoin="round"/>')
    else:
        circle = f'<circle cx="640" cy="{y}" r="20" fill="#ffffff" stroke="{BRAND_STRONG}" stroke-width="4"/>'
    fill = "#b9d597" if done else "#464648"
    return f'{circle}\n  <rect x="684" y="{y - 9}" width="{width}" height="18" rx="9" fill="{fill}"/>'


def feature_graphic() -> str:
    """
    Play's feature graphic (#608), Gunnar's pick "B" of 2026-11-22: the mark over the name, and a
    task list beside them, two of four done.
    """
    size = 0.088
    tasks = "\n  ".join(feature_task(y, width, done) for y, width, done in
                        ((150, 150, True), (217, 190, True), (284, 170, False), (351, 120, False)))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {FEATURE_WIDTH} {FEATURE_HEIGHT}">
  <rect width="{FEATURE_WIDTH}" height="{FEATURE_HEIGHT}" fill="{MINT}"/>
  <g transform="translate(160 66) scale(1.75)">
  {panda()}
  </g>
  <path transform="translate({275 - WORDMARK_WIDTH * size / 2:.1f} 402) scale({size})" fill="{BRAND_STRONG}" d="{WORDMARK}"/>
  <rect x="572" y="80" width="340" height="340" rx="36" fill="#ffffff"/>
  {tasks}
</svg>
"""


def alt_text(svg: str) -> str:
    """A generated diagram's description, as its aria-label holds it."""
    return re.search(r'aria-label="([^"]*)"', svg).group(1)


def sync_alt(page: pathlib.Path, image: str, text: str) -> None:
    """Writes the diagram's description into the `<img alt>` of each `<picture>` on the page that
    shows it, so the text a screen reader gets cannot drift from the drawing. `image` is the light
    file's name, which the `<img>` names as its `src`."""
    html = page.read_text()
    pattern = re.compile(r'(<img alt=")[^"]*(" src="[^"]*' + re.escape(image) + r'">)')
    updated, count = pattern.subn(lambda m: m.group(1) + text + m.group(2), html)
    if count == 0:
        raise SystemExit(f"{page} shows no {image}")
    page.write_text(updated)


def main() -> None:
    per_scheme = {
        "architecture": architecture,
        "architecture-containers": architecture_containers,
        "workflow": workflow,
        "identities": identities,
    }
    for name, build in per_scheme.items():
        for palette in (LIGHT, DARK):
            path = HERE / f"{name}-{palette.name}.svg"
            path.write_text(build(palette))
            print(f"wrote {path.relative_to(HERE.parent.parent)}")

    # The pages that show a diagram carry its description as alt text, from the same source.
    repo = HERE.parent.parent
    for page, name in ((repo / "README.md", "architecture"),
                       (repo / "doc/architecture.md", "architecture-containers"),
                       (repo / "doc/deployment/access.md", "identities"),
                       (repo / "README.md", "workflow")):
        build = per_scheme[name]
        sync_alt(page, f"{name}-light.svg", alt_text(build(LIGHT)))
        print(f"wrote the alt text of {name} in {page.relative_to(repo)}")

    # The mark is the same everywhere it is drawn; the website's copies are written here too, so
    # none of them can be left behind when it changes.
    repo = HERE.parent.parent
    artwork = {
        HERE / "logo-light.svg": logo,
        HERE / "logo-dark.svg": logo,
        HERE / "favicon.svg": logo,
        repo / "frontend/public/favicon.svg": logo,
        repo / "frontend/src/assets/taskfest-mark.svg": logo,
        repo / "mobile/assets/icons/icon.svg": app_icon,
        repo / "mobile/assets/icons/android-icon-foreground.svg": android_foreground,
        repo / "mobile/assets/icons/android-icon-background.svg": android_background,
        repo / "mobile/assets/icons/android-icon-monochrome.svg": android_monochrome,
        repo / "mobile/assets/icons/notification-icon.svg": notification_icon,
        repo / "mobile/assets/icons/feature-graphic.svg": feature_graphic,
    }
    for path, build in artwork.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(build())
        print(f"wrote {path.relative_to(repo)}")


if __name__ == "__main__":
    main()
