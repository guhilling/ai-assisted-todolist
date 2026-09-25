# ai-assisted-todolist

A monorepo for a browser-based todo list with due dates, descriptions, workflow state, OpenID Connect-ready authentication scaffolding, a Quarkus backend, a React + TypeScript frontend, PostgreSQL persistence, and Docker-based delivery.

## Repository layout

- `/backend` - Quarkus REST API with PostgreSQL persistence and container-image settings for `quay.io/ghilling/todo-backend`
- `/frontend` - React + TypeScript single-page application with container build for `quay.io/ghilling/todo-frontend`
- `/e2e` - Playwright browser tests that drive the whole stack through a real Keycloak sign-in
- `/keycloak` - realm export with the local test accounts, shared by Dev Services and the end-to-end stack
- `/docker-compose.yml` - local deployment stack for PostgreSQL, backend, and frontend
- `/docker-compose.e2e.yml` - the same stack plus Keycloak, used by the end-to-end tests
- `/.github/workflows` - frontend CI, backend CI, end-to-end, and image publication workflows

## Backend features

- Todo items with:
  - description
  - due date
  - state (`OPEN`, `PLANNED`, `WORKING`, `DONE`)
- REST endpoints:
  - `GET /api/todos`
  - `POST /api/todos`
  - `PUT /api/todos/{id}`
  - `DELETE /api/todos/{id}`
  - `GET /api/auth/providers`
- PostgreSQL datasource configuration through environment variables
- Container image metadata for Quay
- OpenAPI at `/q/openapi`

## Frontend features

- Browser-based todo dashboard
- Create todos with due dates and workflow state
- Update todo state from the list view
- Sign-in through the backend's OIDC provider: Google in production, a local Keycloak in development

## Local development

### Backend

```bash
cd backend
./mvnw quarkus:dev
```

Dev mode needs nothing but a running container engine. Quarkus Dev Services starts
PostgreSQL and a Keycloak on `http://localhost:8082` (admin `admin`/`admin`), importing
`keycloak/realm-todolist.json` so you can sign in right away:

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `gunnar@example.com` |
| `lasse` | `lasse` | `lasse@example.com` |

Each account owns its own tasks, so signing in as the other one is the quickest way to see
the ownership rules at work.

Google is the only provider in production, and it is configured through environment
variables rather than being checked in - see `.env.example` for the full list. The dev and
test profiles never talk to Google.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`; the dev server proxies `/api` to the backend on port 8080.
Sign in through the "Continue with Keycloak" card.

Optional environment variable:

- `VITE_API_BASE_URL` (optional; defaults to same-origin `/api` in production and `http://localhost:8080` in local Vite development)

### Docker Compose

```bash
docker compose up --build
```

The stack exposes:

- frontend: `http://localhost:3000`
- backend: `http://localhost:8080`
- postgres: `localhost:5432`

### End-to-end tests

The browser tests run against the containerised stack, so build both images first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
cd frontend && docker build -f docker/Dockerfile -t todo-frontend:e2e . && cd ..
docker compose -f docker-compose.e2e.yml up -d --wait
cd e2e && npm ci && npx playwright install chromium && npx playwright test
docker compose -f docker-compose.e2e.yml down -v
```

## CI/CD

- `backend-ci.yml` runs backend tests, JVM packaging, and container image builds
- `e2e.yml` builds both images, starts PostgreSQL, Keycloak, backend and frontend, and runs
  the Playwright tests against them
- `frontend-ci.yml` installs dependencies, lints, builds, and validates the frontend image build
- `publish-images.yml` publishes both images to Quay from `main` or `workflow_dispatch`

Configure the following GitHub secrets before enabling image publication:

- `QUAY_ROBOT_USER` (preferred) or `QUAY_USERNAME`
- `QUAY_ROBOT_PASSWORD` / `QUAY_ROBOT_TOKEN` (preferred) or `QUAY_PASSWORD`
