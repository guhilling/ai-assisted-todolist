# Dev mode

## 1. Start the backend

```bash
cd backend
./mvnw quarkus:dev
```

Quarkus Dev Services starts two containers for you and wires the application to them:

- **PostgreSQL** (`postgres:18-alpine`) on a random port, with a fresh schema applied by
  Liquibase. The data is discarded when dev mode stops.
- **Keycloak** (`quay.io/keycloak/keycloak:26.4`) on **`http://localhost:8082`**, importing
  `keycloak/realm-taskfest.json`. Its admin console is at `http://localhost:8082` with
  `admin` / `admin`.

The backend itself listens on `http://localhost:8080`. The Dev UI is at
`http://localhost:8080/q/dev/`.

First start pulls both images and takes a few minutes; later starts take seconds.

## 2. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **`http://localhost:5173`**. The Vite dev server proxies `/api` to the backend, so the
whole app — including sign-in — stays on port 5173.

## 3. Sign in

The landing page shows a single **"Sign in with Keycloak"** button. Use either account:

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `jboss.gunnar@hilling.de` |
| `lasse` | `lasse` | `lasse@example.com` |

Each account owns its own tasks, so signing in as the other is the quickest way to see the
ownership rules at work. Note that signing out of the app does **not** sign you out of
Keycloak — to switch accounts for real, use a private window or clear cookies for
`localhost:8082`. This is by design; see [authentication.md](../authentication.md).

**No "Google" button appears, and that is correct.** Google is declared locally but has no
credentials, so `/api/auth/providers` reports it with `available: false` and the frontend
hides it — a provider you cannot use is not offered. The endpoint still lists it, which is
how a caller tells "declared but unconfigured" from "never declared" at all.

