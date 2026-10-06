# Testing

Tests are written before the code they cover — see the `CLAUDE.md` files. This page is
about what exists and how to run it.

## The layers

| Layer | Where | Boots | Runs in |
| --- | --- | --- | --- |
| Backend unit / integration | `backend/src/test/**` | Quarkus + real PostgreSQL + Keycloak via Dev Services | `backend-ci.yml`, `sonarcloud.yml` |
| Frontend unit | `frontend/src/dates.test.ts` | nothing; pure functions | `frontend-ci.yml`, `sonarcloud.yml` |
| Frontend component | `frontend/src/App.test.tsx` | jsdom, stubbed `fetch` | `frontend-ci.yml`, `sonarcloud.yml` |
| Browser end-to-end | `e2e/tests/` | the whole containerised stack | `e2e.yml` |
| Live | `e2e/live/` | nothing: checks a deployed environment through CloudFront | `live-tests.yml`, after each deploy to qa |

The backend's split between "unit" and "integration" is not about annotations but about
what a test needs: most of it needs a real database, because that is where the behaviour
being checked actually lives. H2 is deliberately not used — it does not reflect
PostgreSQL closely enough to be worth the speed.

**The packaged artifact is tested by the browser suite, not by `@QuarkusIntegrationTest`**
(#69). `e2e.yml` builds the real backend image and runs it with the `prod` profile next to
PostgreSQL and Keycloak, on every pull request that touches backend or frontend. That is a
stronger check of the built artifact than rerunning the `@QuarkusTest` classes against the jar
would be: most of them depend on `@TestSecurity`, Hibernate statistics or injected beans, which
only exist in-JVM, and each extra Quarkus start is time backend CI does not have (#134). The
one `@QuarkusIntegrationTest` there was never ran — it was enabled only by a `native` profile
nothing built — and was removed with it. If native images ever come back, they bring their own
integration job. **Nothing runs only after merging**: a failure found on `main` has already
landed.


## In this chapter

| Page | What it covers |
| --- | --- |
| [Backend](backend.md) | Unit and Quarkus tests, Dev Services, the real sign-in |
| [Frontend](frontend.md) | Unit and component tests with Vitest |
| [Browser end-to-end](browser-end-to-end.md) | The Playwright suite against the container stack |
| [Live tests](live.md) | Checks of a deployed environment, after every deploy to qa |
| [Coverage](coverage.md) | How coverage is measured, and the gate |
| [Mutation testing](mutation-testing.md) | PIT, its scope, and why it reports without blocking |
| [Continuous integration](continuous-integration.md) | Which workflow runs what, and when |
