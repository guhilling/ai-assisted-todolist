# Testing

Tests are written before the code they cover — see the `CLAUDE.md` files. This page is
about what exists and how to run it.

## The layers

| Layer | Where | Boots | Runs in |
| --- | --- | --- | --- |
| Backend unit / integration | `backend/src/test/**` | Quarkus + real PostgreSQL + Keycloak via Dev Services | `backend-ci.yml`, `sonarcloud.yml` |
| Packaged smoke test | `TaskResourceIT` | the built runner | skipped by default |
| Frontend unit | `frontend/src/dates.test.ts` | nothing; pure functions | `frontend-ci.yml`, `sonarcloud.yml` |
| Frontend component | `frontend/src/App.test.tsx` | jsdom, stubbed `fetch` | `frontend-ci.yml`, `sonarcloud.yml` |
| Browser end-to-end | `e2e/tests/` | the whole containerised stack | `e2e.yml` |

The backend's split between "unit" and "integration" is not about annotations but about
what a test needs: most of it needs a real database, because that is where the behaviour
being checked actually lives. H2 is deliberately not used — it does not reflect
PostgreSQL closely enough to be worth the speed.


## In this chapter

| Page | What it covers |
| --- | --- |
| [Backend](backend.md) | Unit and Quarkus tests, Dev Services, the real sign-in |
| [Frontend](frontend.md) | Unit and component tests with Vitest |
| [Browser end-to-end](browser-end-to-end.md) | The Playwright suite against the container stack |
| [Coverage](coverage.md) | How coverage is measured, and the gate |
| [Mutation testing](mutation-testing.md) | PIT, its scope, and why it reports without blocking |
| [Continuous integration](continuous-integration.md) | Which workflow runs what, and when |
