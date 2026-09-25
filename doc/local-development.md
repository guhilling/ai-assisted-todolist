# Running the application locally

Two ways to run the whole thing. Pick by what you are doing:

| | Dev mode | Container stack |
| --- | --- | --- |
| **Use it for** | Working on the app | Checking the deployment shape |
| **Starts** | Quarkus dev mode + Vite, with PostgreSQL and Keycloak in containers | Everything in containers |
| **Sign-in** | Works out of the box, local accounts | Off, unless you supply Google credentials |
| **Live reload** | Yes, both sides | No |
| **Open** | `http://localhost:5173` | `http://localhost:3000` |

**Dev mode is the default answer.** It is the only one of the two where you can sign in
without external credentials.

## Prerequisites

- **A container engine** — Docker Desktop or Podman. Quarkus Dev Services needs a reachable
  socket; with Podman, `DOCKER_HOST` must point at the machine's socket (see
  [Troubleshooting](#troubleshooting)).
- **JDK 25, Temurin.** `java -version` should report 25. Maven comes from the wrapper.
- **Node 22** and npm, for the frontend.

Nothing else. In particular you need no `.env` file, no database installed, and no OIDC
credentials of your own.

## Dev mode

### 1. Start the backend

```bash
cd backend
./mvnw quarkus:dev
```

Quarkus Dev Services starts two containers for you and wires the application to them:

- **PostgreSQL** (`postgres:17-alpine`) on a random port, with a fresh schema applied by
  Liquibase. The data is discarded when dev mode stops.
- **Keycloak** (`quay.io/keycloak/keycloak:26.4`) on **`http://localhost:8082`**, importing
  `keycloak/realm-todolist.json`. Its admin console is at `http://localhost:8082` with
  `admin` / `admin`.

The backend itself listens on `http://localhost:8080`. The Dev UI is at
`http://localhost:8080/q/dev/`.

First start pulls both images and takes a few minutes; later starts take seconds.

### 2. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open **`http://localhost:5173`**. The Vite dev server proxies `/api` to the backend, so the
whole app — including sign-in — stays on port 5173.

### 3. Sign in

The landing page shows a **"Continue with Keycloak"** card. Use either account:

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `gunnar@example.com` |
| `lasse` | `lasse` | `lasse@example.com` |

Each account owns its own tasks, so signing in as the other is the quickest way to see the
ownership rules at work. Note that signing out of the app does **not** sign you out of
Keycloak — to switch accounts for real, use a private window or clear cookies for
`localhost:8082`. This is by design; see [authentication.md](authentication.md).

A "Google" card also appears, greyed out. That is correct: Google is declared but has no
credentials locally, and a credential-less provider is meant to render disabled.

## Container stack

The production-shaped stack: nginx serving built assets, the backend as a container image,
PostgreSQL with a persistent volume. **No Keycloak**, so sign-in is off unless you supply
real Google credentials.

The backend image is built by Jib rather than from a Dockerfile, so build it first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
docker compose -f docker/docker-compose.yml up --build
```

- frontend: `http://localhost:3000`
- backend: `http://localhost:8080`
- postgres: `localhost:5432` (`todolist` / `todolist` / `todolist`)

To point this stack at real Google credentials, copy `.env.example` to `.env`, fill it in
and set `QUARKUS_OIDC_ENABLED=true` and `TODO_AUTH_ENABLED=true`. `.env` is git-ignored and
must stay that way.

Tear down with `docker compose -f docker/docker-compose.yml down`, or `down -v` to discard
the database volume as well.

## End-to-end stack

The same stack plus Keycloak, which is what the Playwright suite runs against. Both images
have to exist first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
cd frontend && docker build -f docker/Dockerfile -t todo-frontend:e2e . && cd ..

docker compose -f docker/docker-compose.e2e.yml up -d --wait

cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

Here the app is on `http://localhost:3000` with sign-in enabled against Keycloak on
`http://localhost:8082`, so you can also drive it by hand with the accounts above.

Always tear it down when finished — it binds the same ports as the other stacks:

```bash
docker compose -f docker/docker-compose.e2e.yml down -v
```

See [testing.md](testing.md) for what the suite covers and how to run it interactively.

## Troubleshooting

**Dev Services does nothing, or Maven reports no container runtime.** Quarkus needs a
Docker-compatible socket. With Podman on macOS, start the machine and export the socket it
prints:

```bash
podman machine start
export DOCKER_HOST="unix://$(podman machine inspect --format '{{.ConnectionInfo.PodmanSocket.Path}}')"
```

**The Keycloak container starts and is immediately killed (exit 137).** It has run out of
memory — the default Podman machine is too small for it. Give the machine more:

```bash
podman machine stop
podman machine set --memory 5120 --cpus 4
podman machine start
```

**`docker build` succeeds but Compose cannot find the image.** With a buildx
`docker-container` driver the build result stays in the build cache rather than in the
image store; add `--load` to the `docker build` command.

**Port 8080, 8082, 5173 or 3000 is already in use.** Usually one of the other stacks is
still up. `docker compose -f docker/docker-compose.e2e.yml down -v` and
`docker compose -f docker/docker-compose.yml down`, then check for a stray `quarkus:dev`.

**Signed in, but every request comes back 401.** Usually a `q_session` cookie left over
from a previous run whose Keycloak realm no longer exists — the cookie decrypts to tokens
issued by a dead instance. Clear cookies for `localhost:5173` (or `:3000`) and sign in
again.

**Sign-in lands you on port 8080 instead of returning to the app.** A proxy is rewriting
the `Host` header. Check `changeOrigin: false` in `frontend/vite.config.ts`, or
`proxy_set_header Host $http_host` in `frontend/docker/nginx.conf`.

**502 on `/api/auth/callback` through nginx.** The session cookie exceeded nginx's header
buffer. The `proxy_buffer_size` directives in `frontend/docker/nginx.conf` are what prevent
this; check they are still there.

**The backend container exits immediately with no log output.** The image was built on a
base with an older JDK than the code targets. `quarkus.jib.base-jvm-image` must stay pinned
to a Java 25 base.
