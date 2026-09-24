# CLAUDE.md

Guidance for Claude Code when working in this repository.

## About this project

This is `ai-assisted-todolist`: a browser-based todo list app (Quarkus backend,
React + TypeScript frontend, PostgreSQL persistence). It is primarily a **demo
project** — its main purpose is to build up experience with AI-assisted
software development, not to ship production software. Favor clarity and
learning value in explanations and commits over maximal speed.

## About the developer

Gunnar Hilling. Experienced software developer, especially with Java and
Quarkus. Do not over-explain Java/Quarkus/backend fundamentals — assume that
knowledge. Frontend (React/TypeScript) and AI-assisted workflows are areas
where more context and explanation are welcome.

## Ask, don't guess

If a requirement, API contract, data model, or design decision is unclear or
underspecified, **stop and ask** rather than guessing or picking a default
silently. This applies especially to:

- Domain rules and business logic for the todo model (states, transitions,
  validation rules).
- Auth/OIDC provider behavior and configuration.
- Anything where multiple reasonable implementations exist and the choice
  affects the design.

Guessing silently and moving on is the failure mode to avoid here, even if it
slows things down.

## Development methodology

- **TDD for implementation.** Write a failing test first, then the minimal
  code to make it pass, then refactor. This applies to both backend
  (JUnit/Quarkus test framework) and frontend (whatever test runner is
  configured) work. Don't write production code without a test driving it.
- **DDD for planning.** When planning a feature or change, think in terms of
  the domain first: ubiquitous language, entities, value objects, aggregates,
  and bounded contexts, before jumping to REST endpoints, database schema, or
  UI components. Surface domain modeling questions to Gunnar rather than
  assuming an answer.
