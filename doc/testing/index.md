# Testing

Tests are written before the code they cover — see the `CLAUDE.md` files. This page is
about what exists and how to run it.

## The layers

| Layer | Where | Boots | Runs in |
| --- | --- | --- | --- |
| Backend | `serverless/**/*_test.go`, next to the code | nothing, or DynamoDB Local and LocalStack through Testcontainers | `serverless-ci.yml`, `sonarcloud.yml` |
| Frontend unit | `frontend/src/*.test.ts` (`dates.test.ts`, `api.test.ts`, …) | nothing; pure functions | `frontend-ci.yml`, `sonarcloud.yml` |
| Frontend component | `frontend/src/*.test.tsx` (`App.*.test.tsx` by feature, …) | jsdom, stubbed `fetch` from `frontend/src/testing/` | `frontend-ci.yml`, `sonarcloud.yml` |
| Browser end-to-end | `e2e/tests/` | the whole containerised stack | `e2e-serverless.yml` |
| Mobile unit / component | `mobile/src/**/*.test.ts(x)` | nothing; `jest-expo` and React Native Testing Library | `mobile-ci.yml` |
| Mobile end-to-end | `mobile/maestro/` | the app on an Android emulator, against the containerised stack | `mobile-ci.yml` |
| Live | `e2e/live/`, `mobile/maestro/live/` | nothing: checks a deployed environment through CloudFront, in a browser and in the released Android app | `live-tests.yml`, after each deploy to qa |

**Watch them run:** [the newest live run](https://taskfest-docs.cloud.hilling.de/videos/)
has a video of each signed-in scenario and each of the app's flows against qa, replaced by every run
([live tests](live.md) says how they are made).

The Go backend's tests are described with its code in
[serverless.md](../deployment/serverless.md) and `serverless/CLAUDE.md`: a fake for the one AWS
call each part makes, and DynamoDB Local or LocalStack where the store or the bucket itself is what
is being checked.

**The packaged artifact is tested by the browser suite** (#69). `e2e-serverless.yml` builds the
Go backend's image from the same `cmd/api` Lambda runs, and the frontend's, and runs them with
Keycloak, DynamoDB Local and SeaweedFS on every pull request that touches either. **Nothing runs
only after merging**: a failure found on `main` has already landed. The Quarkus backend's own
tests, with its mutation testing (PIT) and its JaCoCo coverage gate, went with it in #559; the tag
`pre-serverless` keeps them.

## In this chapter

| Page | What it covers |
| --- | --- |
| [Frontend](frontend.md) | Unit and component tests with Vitest |
| [Browser end-to-end](browser-end-to-end.md) | The Playwright suite against the container stack |
| [Live tests](live.md) | Checks of a deployed environment, after every deploy to qa |
| [Coverage](coverage.md) | How coverage is measured, and the gate |
| [Continuous integration](continuous-integration.md) | Which workflow runs what, and when |
