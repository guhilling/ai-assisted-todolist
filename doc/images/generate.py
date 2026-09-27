#!/usr/bin/env python3
"""
Generates the README's diagrams as SVG, one file per diagram per colour scheme.

Run it after changing anything a diagram claims:

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


def main() -> None:
    diagrams = {"architecture": architecture, "workflow": workflow}
    for name, build in diagrams.items():
        for palette in (LIGHT, DARK):
            path = HERE / f"{name}-{palette.name}.svg"
            path.write_text(build(palette))
            print(f"wrote {path.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
