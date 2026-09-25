# Purpose

## What this is

A browser-based todo list. A signed-in user keeps a small board of tasks, each with a
description, a due date, an importance and a workflow state. Tasks are private to their
owner. That is the whole product.

## Why it exists

The todo list is not the point. This repository exists to build up practical experience
with **AI-assisted software development** — what works, what does not, and which
conventions make a codebase pleasant for a human and a model to work in together.

That goal shapes several things that would otherwise look like over-engineering for an
application this small:

- **The domain is deliberately modest** so that attention goes to the process rather than
  to domain complexity. There is no sharing, no recurrence, no notifications.
- **The stack is deliberately current** — Quarkus 3.25, Java 25, React 19, TypeScript 6 —
  because working near the edge is where the friction, and therefore the learning, is.
- **Clarity beats speed.** Explanations and commit messages are expected to say *why*, not
  just *what*. A change that works but leaves nobody wiser has missed the point.

## Working conventions

These follow from the goal, and are stated in full in the `CLAUDE.md` files at the
repository root and in `backend/` and `frontend/`:

- **Ask, don't guess.** An underspecified requirement is surfaced, not silently resolved
  with a plausible default. A wrong guess that compiles is the expensive failure mode.
- **Test-driven implementation.** A failing test first, then the minimal code to pass it.
  This holds on both sides of the stack.
- **Domain-driven planning.** Features are thought about in domain terms — language,
  entities, aggregates — before endpoints, tables or components.
- **Automate every check that can be automated.** Tests, coverage, linting, style and the
  browser end-to-end run all execute in GitHub Actions. A convention that only lives in a
  document is one nobody will enforce at three in the afternoon.
- **Documentation is part of the change**, not a follow-up: Javadoc and TSDoc saying what
  a type is *for*, and this folder for anything larger than a single type.

## What is deliberately absent

No user registration, no password handling, no roles or permissions beyond ownership, no
multi-tenancy, and no production deployment yet. AWS is the intended target and the
`docker/` folder is where that material will land; until the target is actually chosen,
writing it down would be fiction.
