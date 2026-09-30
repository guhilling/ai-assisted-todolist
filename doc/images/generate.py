#!/usr/bin/env python3
"""
Generates the project's SVG artwork: the README's diagrams, and the logo.

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
    """One colour scheme. `accent` is reserved for the single claim each diagram makes."""

    name: str
    bg: str
    surface: str
    border: str
    text: str
    muted: str
    accent: str
    accent_soft: str


LIGHT = Palette(
    name="light",
    bg="#ffffff",
    surface="#f6f8fa",
    border="#d5dbe1",
    text="#1a1f24",
    muted="#5b6672",
    accent="#1a73e8",
    accent_soft="#e8f0fe",
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
)

FONT = (
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
    "Helvetica, Arial, sans-serif"
)


def esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def box(x, y, w, h, lines, p: Palette, *, accent=False, dashed=False, radius=10):
    """A labelled rectangle. `lines` is a list; the first is the name, the rest are detail."""
    fill = p.accent_soft if accent else p.surface
    stroke = p.accent if accent else p.border
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
    """How a request travels, and where the tokens stop."""
    w, h = 1000, 390
    row_y, box_h = 190, 72
    bottom = row_y + box_h

    parts = [
        box(30, row_y, 150, box_h, ["Browser", "the SPA"], p),
        box(270, row_y, 170, box_h, ["httpd", "static files + /api"], p),
        box(530, row_y, 190, box_h, ["Quarkus backend", "the OIDC client"], p, accent=True),
        box(810, row_y, 160, box_h, ["PostgreSQL", "Liquibase schema"], p),
        box(530, 40, 190, 64, ["Identity provider", "Keycloak \u00b7 Google"], p),

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
    ]
    aria = (
        "The browser talks only to httpd, which serves the app and proxies /api to the "
        "Quarkus backend. The backend is the OIDC client: it exchanges the code with the "
        "identity provider itself and returns an encrypted session cookie, so the browser "
        "never holds a token."
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
            ["todolist-<env>-lifecycle", "a role gunnar assumes", "MFA required"], p),
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
            ["todolist-<env>-deploy", "GitHub Actions, via OIDC", "no stored credential"], p,
            accent=True),
        box(right_x, rows[2], right_w, box_h,
            ["Redeploy only",
             "task definition \u00b7 service \u00b7 migration task",
             "frontend artifact \u2192 site bucket"], p),
        arrow([(left_x + left_w, rows[2] + box_h / 2), (right_x, rows[2] + box_h / 2)], p,
              accent=True),
        label(380, rows[2] + box_h / 2 - 10, "updates", p, accent=True),

        box(left_x, 470, left_w, 84,
            ["todolist-monitoring", "read-only, everywhere", "a person at a console"], p),
        box(right_x, 470, right_w, 84,
            ["todolist-<env>-task-execution \u00b7 -task",
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
        "CodeQL + SonarCloud",
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
        "the tests and coverage gate, CodeQL and SonarCloud, and the browser end-to-end run "
        "before it is squashed onto main. PIT mutation testing reports but does not block."
    )
    return document(w, h, "\n  ".join(parts), p, aria)


# The mark, as geometry rather than as a literal, because three files draw the same shape: the
# two colour variants and the self-adapting favicon.
#
# A rounded square with its top-right corner deliberately missing, and a check mark leaving
# through the gap. The open corner is the whole idea: a closed box with a tick in it is the most
# generic todo icon there is, and a task that is done is one that has left the list rather than
# one that sits in it wearing a mark. It also survives being 16 pixels wide, which a busier
# drawing would not.
LOGO_VIEWBOX = 128
# Clockwise from where the right edge resumes below the absent corner, round to where the top
# edge stops before it. The arcs are the three corners that do exist.
LOGO_OUTLINE = (
    "M 112 54 L 112 86 A 26 26 0 0 1 86 112 L 42 112 "
    "A 26 26 0 0 1 16 86 L 16 42 A 26 26 0 0 1 42 16 L 70 16"
)
# Ends outside the square, past where the corner would have been.
LOGO_CHECK = "M 40 68 L 58 88 L 118 24"


def logo_body(outline: str, check: str) -> str:
    """The two strokes, given the colours or the class names that will carry them."""
    return (
        f'<path d="{LOGO_OUTLINE}" fill="none" {outline} stroke-width="9" '
        'stroke-linecap="round"/>\n  '
        f'<path d="{LOGO_CHECK}" fill="none" {check} stroke-width="12" '
        'stroke-linecap="round" stroke-linejoin="round"/>'
    )


ARIA_LOGO = (
    "A rounded square missing its top-right corner, with a check mark leaving through the gap"
)


def logo(p: Palette) -> str:
    """
    The mark, on no background at all.

    Transparent rather than filled, unlike the diagrams: a logo has to sit on a README, a page
    header and a browser tab, and a background of its own would be wrong on at least one of
    them. The colour variants exist so the strokes suit what it is sitting on.
    """
    body = logo_body(f'stroke="{p.text}"', f'stroke="{p.accent}"')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LOGO_VIEWBOX} {LOGO_VIEWBOX}"\n'
        f'     width="{LOGO_VIEWBOX}" height="{LOGO_VIEWBOX}" role="img"\n'
        f'     aria-label="{ARIA_LOGO}">\n  {body}\n</svg>\n'
    )


def favicon() -> str:
    """
    One file for the browser tab, choosing its own colours.

    A tab is the one place that cannot be handed two files and told to pick, the way a README
    does with `<picture>` and a page does with a media query in CSS. An SVG favicon can carry
    the query itself, so this is a single file that adapts.
    """
    body = logo_body('class="edge"', 'class="tick"')
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LOGO_VIEWBOX} {LOGO_VIEWBOX}"
     role="img" aria-label="{ARIA_LOGO}">
  <style>
    .edge {{ stroke: {LIGHT.text}; }}
    .tick {{ stroke: {LIGHT.accent}; }}
    @media (prefers-color-scheme: dark) {{
      .edge {{ stroke: {DARK.text}; }}
      .tick {{ stroke: {DARK.accent}; }}
    }}
  </style>
  {body}
</svg>
"""


def main() -> None:
    per_scheme = {
        "architecture": architecture,
        "workflow": workflow,
        "identities": identities,
        "logo": logo,
    }
    for name, build in per_scheme.items():
        for palette in (LIGHT, DARK):
            path = HERE / f"{name}-{palette.name}.svg"
            path.write_text(build(palette))
            print(f"wrote {path.relative_to(HERE.parent.parent)}")

    path = HERE / "favicon.svg"
    path.write_text(favicon())
    print(f"wrote {path.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
