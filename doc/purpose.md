# Purpose

## What this is

A todo list, on the web and as an app for iOS and Android. A signed-in user keeps a small
board of tasks, each with a description, a due date, an importance and a workflow state, and
files attached to it. The website and the apps show the same board; the apps also remind on the
day a task is due, keep the board readable offline, and turn what another app shares into a
task. Tasks are private to their owner. That is the whole product.

## Why it exists

The todo list is not the point. This repository exists to build up practical experience
with **AI-assisted software development** — what works, what does not, and which
conventions make a codebase pleasant for a human and a model to work in together.

That goal shapes several things that would otherwise look like over-engineering for an
application this small:

- **The domain is deliberately modest** so that attention goes to the process rather than
  to domain complexity. There is no sharing between users, no recurrence, and no reminder
  beyond the apps' one on the due day.
- **The stack is deliberately current** — Quarkus 3, Java 25, React 19, TypeScript 7, and
  Expo for the apps — because working near the edge is where the friction, and therefore the
  learning, is. Renovate keeps it there.
- **Clarity beats speed.** Explanations and commit messages are expected to say *why*, not
  just *what*. A change that works but leaves nobody wiser has missed the point.

## Working conventions

These follow from the goal, and are stated in full in the `CLAUDE.md` files at the
repository root and in `backend/`, `frontend/` and `mobile/`:

- **Ask, don't guess.** An underspecified requirement is surfaced, not silently resolved
  with a plausible default. A wrong guess that compiles is the expensive failure mode.
- **Test-driven implementation.** A failing test first, then the minimal code to pass it.
  This holds on both sides of the stack.
- **Domain-driven planning.** Features are thought about in domain terms — language,
  entities, aggregates — before endpoints, tables or components.
- **Automate every check that can be automated.** Tests, coverage, linting, style, the
  browser end-to-end run and the apps' runs on an emulator and a simulator all execute in
  GitHub Actions. A convention that only lives in a
  document is one nobody will enforce at three in the afternoon.
- **Documentation is part of the change**, not a follow-up: Javadoc and TSDoc saying what
  a type is *for*, and this folder for anything larger than a single type.

## What is deliberately absent

No user registration, no password handling, no roles or permissions beyond ownership, and no
multi-tenancy. It runs on AWS, in a `qa` and a `prod` environment
([deployment](deployment/index.md)), and the apps reach testers through TestFlight and Play's
internal testing ([distribution](mobile/distribution.md)), not the stores' public listings.
