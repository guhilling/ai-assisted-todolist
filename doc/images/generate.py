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


def arrow(points, p: Palette, *, accent=False, dashed=False, marker="arrow"):
    """A polyline with an arrowhead at the end. `points` is [(x, y), ...]."""
    colour = p.accent if accent else p.muted
    dash = ' stroke-dasharray="5 4"' if dashed else ""
    path = " ".join(f"{x},{y}" for x, y in points)
    suffix = "-accent" if accent else ""
    return (
        f'<polyline points="{path}" fill="none" stroke="{colour}" stroke-width="1.6"'
        f'{dash} marker-end="url(#{marker}{suffix})"/>'
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
    """How a request travels, where the tokens stop, and how files bypass the backend."""
    w, h = 1000, 500
    row_y, box_h = 190, 72
    bottom = row_y + box_h

    parts = [
        # Ours in blue, AWS services in orange, someone else's in green.
        box(30, row_y, 150, box_h, ["Browser", "the SPA"], p, accent=True),
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
        arrow([(105, row_y), (105, 72), (530, 72)], p),
        label(310, 62, "redirected to sign in", p),

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
        label(380, 444, "files, straight: presigned PUT and GET", p, accent=True, size=12),
        label(380, 476, "file content never passes through the backend", p, accent=True, size=12),
    ]
    aria = (
        "The browser talks only to CloudFront, which serves the app from S3 and passes /api to "
        "the Quarkus backend. The backend is the OIDC client: it exchanges the code with the "
        "identity provider, Google, itself and returns an encrypted session cookie, so the browser "
        "never holds a token. The database is PostgreSQL on RDS. Files attached to tasks go straight between the browser and S3 "
        "through presigned links the backend signs, so their content never passes through it."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


def identities(p: Palette) -> str:
    """Who may do what to AWS, and where the line between a person and automation falls."""
    w, h = 1020, 600
    left_x, left_w = 40, 250
    right_x, right_w = 470, 510
    box_h = 90
    rows = (40, 180, 340)
    line_y = 300

    parts = [
        box(left_x, rows[0], left_w, box_h,
            ["gunnar", "IAM admin user \u00b7 MFA", "not the account root user"], p),
        box(right_x, rows[0], right_w, box_h,
            ["Foundation \u2014 free, created once",
             "VPC \u00b7 subnets \u00b7 route tables \u00b7 security groups",
             "IAM \u00b7 ACM certificate \u00b7 Route 53 records"], p),
        arrow([(left_x + left_w, rows[0] + box_h / 2), (right_x, rows[0] + box_h / 2)], p),
        label(380, rows[0] + box_h / 2 - 10, "creates", p),

        box(left_x, rows[1], left_w, box_h,
            ["taskfest-<env>-lifecycle", "a role gunnar assumes", "MFA required"], p),
        box(right_x, rows[1], right_w, box_h,
            ["Everything that bills",
             "RDS instance \u00b7 load balancer \u00b7 Fargate service",
             "destroyed again when nothing is being demoed"], p, dashed=True),
        # The right half stays dashed: the role exists, the resources it will create do not yet.
        arrow([(left_x + left_w, rows[1] + box_h / 2), (right_x, rows[1] + box_h / 2)], p,
              dashed=True),
        label(380, rows[1] + box_h / 2 - 10, "creates \u00b7 destroys", p),

        # The claim: the only identity that runs unattended is the one that cannot create
        # anything. Everything with a bill attached to it needs a person.
        rule(30, 990, line_y, p, accent=True),
        label(34, line_y - 10, "above \u2014 a person at a terminal; prod needs an approval", p,
              anchor="start"),
        label(34, line_y + 22,
              "below \u2014 unattended, and cannot create, change or delete infrastructure", p,
              anchor="start", accent=True, size=12),

        box(left_x, rows[2], left_w, box_h,
            ["taskfest-<env>-deploy", "GitHub Actions, via OIDC", "no stored credential"], p,
            accent=True),
        box(right_x, rows[2], right_w, box_h,
            ["Redeploy only",
             "task definition \u00b7 service \u00b7 migration task",
             "frontend artifact \u2192 site bucket"], p),
        arrow([(left_x + left_w, rows[2] + box_h / 2), (right_x, rows[2] + box_h / 2)], p,
              accent=True),
        label(380, rows[2] + box_h / 2 - 10, "updates", p, accent=True),

        box(left_x, 470, left_w, 84,
            ["taskfest-monitoring", "read-only, everywhere", "a person at a console"], p),
        box(right_x, 470, right_w, 84,
            ["taskfest-<env>-task-execution \u00b7 -task",
             "what the container runs as \u2014 nobody assumes these",
             "pulls the image, reads the database secret, writes logs"], p),
        arrow([(725, rows[2] + box_h), (725, 470)], p),
        label(738, 452, "iam:PassRole \u2014 only these two, only to ECS", p, anchor="start"),
    ]
    aria = (
        "Three identities, in order of how much they may do. A human IAM admin creates the "
        "free foundation once: the VPC, subnets, security groups, IAM, the certificate and "
        "the DNS records. A role that same human assumes creates and destroys everything "
        "that bills: the database, the load balancer and the Fargate service. Below the "
        "line, the only unattended identity is the deploy role, assumed from GitHub Actions "
        "through OIDC, which may update the service and the site bucket and cannot create, "
        "change or delete any infrastructure. Separately, the task roles are what the "
        "container runs as rather than an identity anyone assumes, and a read-only user "
        "exists for looking at things."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


def workflow(p: Palette) -> str:
    """What every change passes through, and the one gate that deliberately does not block."""
    w, h = 1090, 420
    row_y, box_h = 172, 56
    gates = [
        "Checkstyle + Javadoc",
        "Tests, coverage 95 / 90",
        "CodeQL",
        "End-to-end in a browser",
        "PIT mutation \u00b7 reports only",
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
        report_only = i == len(gates) - 1
        parts.append(box(pill_x, y, pill_w, gate_h, [name], p, dashed=report_only, radius=8))

    parts += [
        # The loop closes: nobody starts the next change by hand.
        arrow([(1005, 228), (1005, 372), (95, 372), (95, 228)], p),
        label(550, 392, "Renovate opens the next change; a git tag cuts a release", p),
    ]
    aria = (
        "Every change starts from a question rather than a guess, then a failing test, then "
        "the change and its documentation in one commit. A pull request must pass Checkstyle, "
        "the tests and coverage gate, CodeQL, and the browser end-to-end run before it is "
        "squashed onto main. SonarCloud then analyses main, and a failed quality gate becomes "
        "a GitHub issue. PIT mutation testing reports but does not block."
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


def main() -> None:
    per_scheme = {
        "architecture": architecture,
        "workflow": workflow,
        "identities": identities,
    }
    for name, build in per_scheme.items():
        for palette in (LIGHT, DARK):
            path = HERE / f"{name}-{palette.name}.svg"
            path.write_text(build(palette))
            print(f"wrote {path.relative_to(HERE.parent.parent)}")

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
    }
    for path, build in artwork.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(build())
        print(f"wrote {path.relative_to(repo)}")


if __name__ == "__main__":
    main()
