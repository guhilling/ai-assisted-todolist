<p align="center">
  <a href="https://taskfest-docs.cloud.hilling.de/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="doc/images/logo-dark.svg">
      <img src="doc/images/logo-light.svg" alt="" width="92" height="92">
    </picture>
  </a>
</p>

# TaskFest

[![Serverless CI](https://github.com/guhilling/ai-assisted-todolist/actions/workflows/serverless-ci.yml/badge.svg?branch=main)](https://github.com/guhilling/ai-assisted-todolist/actions/workflows/serverless-ci.yml)
[![Frontend CI](https://github.com/guhilling/ai-assisted-todolist/actions/workflows/frontend-ci.yml/badge.svg?branch=main)](https://github.com/guhilling/ai-assisted-todolist/actions/workflows/frontend-ci.yml)
[![CodeQL](https://github.com/guhilling/ai-assisted-todolist/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/guhilling/ai-assisted-todolist/actions/workflows/codeql.yml)
[![Quality gate](https://sonarcloud.io/api/project_badges/measure?project=guhilling_ai-assisted-todolist&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=guhilling_ai-assisted-todolist)

TaskFest is a task list on the web and as an app for iOS and Android: tasks with due dates,
importance and workflow state, private to whoever signed in. A Go backend on AWS Lambda, React +
TypeScript website, an Expo app, DynamoDB persistence, OpenID Connect sign-in.

📖 **[The documentation and the API reference are published at
taskfest-docs.cloud.hilling.de](https://taskfest-docs.cloud.hilling.de/)** —
everything under `doc/` rendered, plus the OpenAPI contract for `main` and for every release.

🎬 **[Watch it run](https://taskfest-docs.cloud.hilling.de/videos/)** — the newest live run
against qa, recorded: each signed-in scenario on the website, and each of the app's flows.

It is deliberately small. A signed-in user keeps a board of tasks and attaches files to them.
The website and the apps show the same board, and the apps add a reminder on the day a task is
due, a board that stays readable offline, and a way to turn what another app shares into a task.
It runs on AWS, and the apps reach testers through TestFlight and Play's internal testing.

"Small" is relative, though: the project holds about 42,000 lines of code, a little under half of
them tests, and about 6,900 lines of documentation (November 2026). Neither counts blank lines,
comments, generated files or Markdown's own markup and code examples.

The todo list is not really the point — this repository exists to build up experience with
AI-assisted software development. See [doc/purpose.md](doc/purpose.md). That is also why the
repository keeps its original name, `ai-assisted-todolist`, for historical reasons: it names the
experiment, and the application inside it is TaskFest.

## How the application fits together

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/images/architecture-dark.svg">
  <img alt="TaskFest on the Go backend, top to bottom. The browser and the iOS and Android apps sign in with Google: the browser is redirected there, the apps sign in themselves. Both talk only to CloudFront, which serves the site's files from S3 and passes /api to API Gateway's HTTP API with a secret header. The HTTP API invokes the api function, Go on Lambda, which serves every route and is the OIDC client: it exchanges the code with Google itself, and the browser holds a session cookie, never a token, while the apps send their ID token as a Bearer token. The api function reads and writes one DynamoDB table and signs links to the attachment bucket, so files go both ways straight between the clients and S3. The table's stream feeds the streams function, and EventBridge Scheduler runs orphans and replay. Every function and the HTTP API report metrics to CloudWatch, which a CloudWatch dashboard draws, and write their log lines to CloudWatch Logs. Ten alarms, nine on the metrics and one on the orphan clean-up's log line through a metric filter, notify an SNS topic, which mails Gunnar. In qa, a subscription filter also hands every log line to logship, which sends it over HTTPS with basic auth to VictoriaLogs and Perses on a shared Hetzner VM, which Gunnar opens through SSH." src="doc/images/architecture-light.svg">
</picture>

The backend is Go on AWS Lambda with one DynamoDB table (#547), billed by the request, so an
environment can stay up for about two dollars a month. It is a *backend-for-frontend*: it is the
OIDC client, it performs the code exchange itself, and what reaches the browser is a session cookie
rather than a token. One origin for the app and its API, so the SPA needs no API base URL:
in AWS that origin is CloudFront, locally and in the end-to-end stack it is httpd, and in
development Vite. Blue is this project's code, orange an AWS service, green someone else's. The iOS
and Android apps, drawn as one because they work alike, cannot carry the cookie: they sign in with
the identity provider themselves and send the ID token as a Bearer token, through the same
CloudFront. The one cross-origin path is a file attached to a task: the browser and the apps upload
and download it straight to and from S3, through links the backend signs. Below the line, how it is
watched: CloudWatch's metrics and logs, alarms that mail, and in qa every log line on a shared
monitoring server with Perses dashboards.

qa and prod run on the Go backend, prod since the cut-over (#557). The containers it replaced,
Quarkus on Fargate with PostgreSQL, are gone from the code (#559) and the infrastructure (#557);
the tag `pre-serverless` keeps them, and is the way back.
[architecture.md](doc/architecture.md#two-architectures) shows the containers' architecture and says
why the backend moved, and [authentication.md](doc/authentication.md) has the sign-in flow in full.

## How a change reaches main

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="doc/images/workflow-dark.svg">
  <img alt="Every change starts from a question rather than a guess, then a failing test, then the change and its documentation in one commit. A pull request must pass gofmt, go vet and oxlint, the tests and the frontend's coverage gate, the contract checks, CodeQL, and the browser end-to-end run before it is squashed onto main. SonarCloud then analyses main, and a failed quality gate becomes a GitHub issue. A git tag on main cuts a release, which is deployed to qa and tested there from outside, the website's scenarios and the app's flows each recorded; the newest run's videos are published on the documentation site." src="doc/images/workflow-light.svg">
</picture>

Anything that can be checked by a machine is, so that a convention does not depend on
somebody remembering it. [The decisions](doc/decisions/index.md) record every choice with its
reasoning.

The diagrams and the logo are generated: edit `doc/images/generate.py` and re-run it rather than
touching the SVGs, which exist in a light and a dark variant that must stay in step. It also writes
the website's favicon and the sources of the app's icons, which `mobile/assets/render-icons.sh`
turns into the PNGs the app is built with and the graphics of its Play listing.

## Getting it running

```bash
docker build -t taskfest-serverless:e2e \
  --build-arg GO_VERSION="$(sed -n 's/^go \([0-9.]*\).*/\1/p' serverless/go.mod)" serverless
cd frontend && docker build -f docker/Dockerfile -t taskfest-frontend:e2e . && cd ..
docker compose -f deployment/docker/docker-compose.e2e.serverless.yml up -d --wait
```

Open `http://localhost:3000` and sign in as `gunnar` / `gunnar`. Nothing else to install
and no credentials to obtain — [doc/local-development/](doc/local-development/index.md) has the
details, the second local account, running the backend and the frontend from source, and the
troubleshooting.

## Documentation

`doc/` is the source of truth; this page is the entry point. Each page answers one
question, so start from the question rather than the filename.

**Understanding it**

| | |
| --- | --- |
| [purpose.md](doc/purpose.md) | *Why does this repository exist, and why is it built the way it is?* |
| [architecture.md](doc/architecture.md) | *What are the pieces, how does a request travel, how is it deployed?* |
| [domain-model.md](doc/domain-model.md) | *What is a Task, and where is each invariant enforced?* |
| [authentication.md](doc/authentication.md) | *How does sign-in work, and why is the backend the OIDC client?* |

**Working on it**

| | |
| --- | --- |
| [local-development/](doc/local-development/index.md) | *How do I run it, and what do I do when it misbehaves?* |
| [testing/](doc/testing/index.md) | *What is tested where, and which checks can fail my build?* |
| [mobile/](doc/mobile/index.md) | *What does the app do, and how is it built, tested and handed to testers?* |
| [deployment/](doc/deployment/index.md) | *Where will this run on AWS, who may change it, and what does it cost?* |
| [releasing.md](doc/releasing.md) | *How do I cut a release, and what does it publish?* |
| [decisions/](doc/decisions/index.md) | *Why is it like this — and what was tried and rejected?* |

`decisions/` is the one worth reading before changing anything structural: several
settings in this repository look removable and are not, and it says which and why.

Code-level documentation lives in the code, as Go doc comments and TSDoc. The conventions are in
[serverless/CLAUDE.md](serverless/CLAUDE.md), [frontend/CLAUDE.md](frontend/CLAUDE.md) and
[mobile/CLAUDE.md](mobile/CLAUDE.md).

## Repository layout

- `serverless/` — the Go backend: the API and four background functions, on AWS Lambda
- `frontend/` — React + TypeScript SPA, attached to every release as a build
- `mobile/` — the iOS and Android app, one Expo codebase, released to TestFlight and Play's internal testing
- `e2e/` — Playwright browser tests driving the whole stack through a real sign-in
- `keycloak/` — realm export with the local test accounts, for the end-to-end stack
- `deployment/` — everything that deploys the app: `docker/` for the Compose stack,
  `aws-tofu/` for the AWS infrastructure as OpenTofu
- `doc/` — project documentation, including `doc/api/`: the wire contract
- `.github/workflows/` — CI for backend, frontend, app, contract, end-to-end, SonarCloud, releases
  and deploys

## API

All endpoints require a session except `/api/auth/providers` and `/api/version`.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/tasks` | the caller's tasks, by due date, then importance (high first) |
| `POST` | `/api/tasks` | create |
| `PUT` | `/api/tasks/{id}` | replace |
| `DELETE` | `/api/tasks/{id}` | delete |
| `GET` | `/api/auth/providers` | sign-in options |
| `GET` | `/api/auth/login` `/logout` `/me` | session |
| `GET` | `/api/version` | the running release, for the prod approval |

A task has a description, a due date, an importance (`LOW`, `MEDIUM`, `HIGH`) and a state
(`TODO` or `DONE`; `WORKING` is no longer offered, see `doc/domain-model.md`).

The contract is **published**, not only served:
[**the API reference**](https://taskfest-docs.cloud.hilling.de/) has `/api/main/` for
the current code and `/api/v1.2.3/` per release, each with the OpenAPI 3.1 document and one
JSON Schema per type. The same files are committed under [`doc/api/`](doc/api/) and attached to
every release. `openapi.json` is the source, edited by hand; the rest is derived from it, and CI
fails if a derived copy has drifted.

## CI/CD

- `serverless-ci.yml` — the Go backend: generated code current, gofmt, `go vet`, tests, the Lambda
  build
- `frontend-ci.yml` — install, lint, build, frontend image build
- `contract-ci.yml` — the API contract is valid, its derived files current, and nothing breaks the
  oldest release in use
- `e2e-serverless.yml` — builds both images, starts the full stack, runs the Playwright suite
- `mobile-ci.yml` — the app's checks and tests, its builds, and its flows on an emulator
- `sonarcloud.yml` — on `main` only: the test suites with coverage, the Sonar scan, and the quality gate, a failure of which opens a GitHub issue
- `codeql.yml` — CodeQL security scanning for TypeScript and Go, plus a weekly run
- `release.yml` — on a `v*` tag: release checks, the Go functions and the frontend build, a GitHub
  Release, and the deploy to qa

## Releases

```bash
git tag -a v1.0.0 -m "TaskFest v1.0.0" && git push origin v1.0.0
```

That is the whole procedure. No version is written down anywhere else: the release build hands
the tag's version to the Go functions and the frontend build, and the frontend package is private
and never published. `release.yml` then refuses pre-release npm dependencies, runs the frontend's
suite, builds the Go functions and the frontend, opens a GitHub Release with them attached, and
deploys it to qa. Details are in [doc/releasing.md](doc/releasing.md).

## Dependencies

Renovate opens the update pull requests, configured in `.github/renovate.json` on top of the
shared preset from [conventions](https://github.com/guhilling/conventions). Patch and
minor updates merge themselves once every check on the pull request is green; major updates
wait for a human. The dependency dashboard issue lists everything outstanding.

## License

Apache License 2.0 — see [LICENSE](LICENSE).

Copyright 2026 Gunnar Hilling.
