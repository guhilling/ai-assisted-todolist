# ai-assisted-todolist

A monorepo for a browser-based todo list with due dates, descriptions, workflow state, OpenID Connect-ready authentication scaffolding, a Quarkus backend, a React + TypeScript frontend, PostgreSQL persistence, and Docker-based delivery.

## Repository layout

- `/backend` - Quarkus REST API with PostgreSQL persistence and container-image settings for `quay.io/ghilling/todo-backend`
- `/frontend` - React + TypeScript single-page application with container build for `quay.io/ghilling/todo-frontend`
- `/docker-compose.yml` - local deployment stack for PostgreSQL, backend, and frontend
- `/.github/workflows` - frontend CI, backend CI, and image publication workflows

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
- Provider overview for Google, Apple, Microsoft Entra ID, and Facebook OIDC configuration placeholders

## Local development

### Backend

```bash
cd /home/runner/work/ai-assisted-todolist/ai-assisted-todolist/backend
./mvnw quarkus:dev
```

Environment variables:

- `QUARKUS_DATASOURCE_JDBC_URL`
- `QUARKUS_DATASOURCE_USERNAME`
- `QUARKUS_DATASOURCE_PASSWORD`
- `QUARKUS_OIDC_ENABLED`
- `TODO_AUTH_ENABLED`
- `TODO_OIDC_GOOGLE_CLIENT_ID`
- `TODO_OIDC_APPLE_CLIENT_ID`
- `TODO_OIDC_ENTRA_CLIENT_ID`
- `TODO_OIDC_FACEBOOK_CLIENT_ID`

### Frontend

```bash
cd /home/runner/work/ai-assisted-todolist/ai-assisted-todolist/frontend
npm install
npm run dev
```

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

## CI/CD

- `backend-ci.yml` runs backend tests, JVM packaging, and container image builds
- `frontend-ci.yml` installs dependencies, lints, builds, and validates the frontend image build
- `publish-images.yml` publishes both images to Quay from `main` or `workflow_dispatch`

Configure the following GitHub secrets before enabling image publication:

- `QUAY_ROBOT_USER` (preferred) or `QUAY_USERNAME`
- `QUAY_ROBOT_PASSWORD` / `QUAY_ROBOT_TOKEN` (preferred) or `QUAY_PASSWORD`
