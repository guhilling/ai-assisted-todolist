# ai-assisted-todolist

A browser-based todo list: tasks with due dates, importance and workflow state, private to
whoever signed in. Quarkus backend, React + TypeScript frontend, PostgreSQL persistence,
OpenID Connect sign-in.

The todo list is not really the point — this repository exists to build up experience with
AI-assisted software development. See [doc/purpose.md](doc/purpose.md).

## Getting it running

```bash
cd backend && ./mvnw quarkus:dev      # starts PostgreSQL and Keycloak for you
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173` and sign in as `gunnar` / `gunnar`. Nothing else to install
and no credentials to obtain — [doc/local-development.md](doc/local-development.md) has the
details, the second local account, the container stacks and the troubleshooting.

## Documentation

`doc/` is the source of truth; this page is the entry point.

| Document | What it covers |
| --- | --- |
| [purpose.md](doc/purpose.md) | What this project is for, and the conventions that follow |
| [architecture.md](doc/architecture.md) | The pieces, how a request travels, how they are deployed |
| [domain-model.md](doc/domain-model.md) | Ubiquitous language, the Task aggregate, the invariants |
| [authentication.md](doc/authentication.md) | The backend-for-frontend OIDC design |
| [local-development.md](doc/local-development.md) | Running and testing everything locally |
| [testing.md](doc/testing.md) | The test layers and how to run them |
| [decisions.md](doc/decisions.md) | Decisions taken, why, and what was rejected |

Code-level documentation lives in the code, as Javadoc and TSDoc. The conventions are in
`backend/CLAUDE.md` and `frontend/CLAUDE.md`, and the backend build enforces them.

## Repository layout

- `backend/` — Quarkus REST API, published as `quay.io/ghilling/todo-backend`
- `frontend/` — React + TypeScript SPA, published as `quay.io/ghilling/todo-frontend`
- `e2e/` — Playwright browser tests driving the whole stack through a real sign-in
- `keycloak/` — realm export with the local test accounts, shared by Dev Services and CI
- `docker/` — Compose stacks; where AWS deployment material will land
- `doc/` — project documentation
- `.github/workflows/` — CI for backend, frontend, end-to-end, SonarCloud and publication

## API

All endpoints require a session except `/api/auth/providers`.

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/tasks` | the caller's tasks, by due date |
| `POST` | `/api/tasks` | create |
| `PUT` | `/api/tasks/{id}` | replace |
| `DELETE` | `/api/tasks/{id}` | delete |
| `GET` | `/api/auth/providers` | sign-in options |
| `GET` | `/api/auth/login` `/logout` `/me` | session |

A task has a description, a due date, an importance (`LOW`, `MEDIUM`, `HIGH`) and a state
(`TODO`, `WORKING`, `DONE`). OpenAPI is at `/q/openapi`, Swagger UI at `/q/swagger-ui`,
Prometheus metrics at `/q/metrics`.

## CI/CD

- `backend-ci.yml` — backend tests, JVM packaging, container image build
- `frontend-ci.yml` — install, lint, build, frontend image build
- `e2e.yml` — builds both images, starts the full stack, runs the Playwright suite
- `sonarcloud.yml` — both test suites with coverage, then the Sonar scan
- `publish-images.yml` — publishes both images to Quay from `main` or `workflow_dispatch`

Image publication needs these repository secrets:

- `QUAY_ROBOT_USER` (preferred) or `QUAY_USERNAME`
- `QUAY_ROBOT_PASSWORD` / `QUAY_ROBOT_TOKEN` (preferred) or `QUAY_PASSWORD`

Production Google credentials are supplied through environment variables and never checked
in; `.env.example` lists them.
