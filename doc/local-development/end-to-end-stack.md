# End-to-end stack

The whole application in containers — Keycloak, the Go backend (#556) with DynamoDB Local and
SeaweedFS for S3, and the frontend behind httpd — which is what the Playwright suite runs against
(`deployment/docker/docker-compose.e2e.serverless.yml`). Both images have to exist first:

```bash
docker build -t taskfest-serverless:e2e \
  --build-arg GO_VERSION="$(sed -n 's/^go \([0-9.]*\).*/\1/p' serverless/go.mod)" serverless
cd frontend && docker build -f docker/Dockerfile -t taskfest-frontend:e2e . && cd ..

docker compose -f deployment/docker/docker-compose.e2e.serverless.yml up -d --wait

cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

Both builds are for the machine they run on, so on an Apple-silicon Mac the images are arm64 and
need no Rosetta.

Here the app is on `http://localhost:3000` with sign-in enabled against Keycloak on
`http://localhost:8082` (admin console `admin` / `admin`), so you can also drive it by hand:

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `gunnar@example.com` |
| `lasse` | `lasse` | `lasse@example.com` |

Each account owns its own tasks, so signing in as the other is the quickest way to see the
ownership rules at work. Signing out of the app does **not** sign you out of Keycloak — to switch
accounts for real, use a private window or clear cookies for `localhost:8082`. This is by design;
see [authentication.md](../authentication.md).

- **The Go server** is `serverless/Dockerfile`: `cmd/api` as a plain HTTP server, the same code
  Lambda runs, built with the toolchain `go.mod` names, passed in as `GO_VERSION`. The frontend
  proxies `/api/` to it at `http://backend:8080`, which is also the frontend image's default
  `TASKFEST_BACKEND_URL`.
- **DynamoDB Local** holds the table, in memory, and **SeaweedFS** the attachments, at
  `http://s3.localhost:8333`, one address for both sides: the backend signs upload and download
  links for it, and the browser follows them. The browser resolves every `*.localhost` to
  127.0.0.1, where the port is published; inside the network, `s3.localhost` is an alias of the
  SeaweedFS container. Two names would mean links signed for a host the browser asks another for,
  and a signature that no longer matches. SeaweedFS checks a presigned upload's signature, size
  and type, and the bucket's CORS rule, as S3 does, once it has an access key
  (`e2e/seaweedfs-s3.json`).
- **`e2e/serverless-init.sh`** creates the table and the bucket `taskfest-attachments`, and the
  bucket's CORS rule. That the rule agrees with AWS's is checked, not hoped for:
  `.github/scripts/check-cors-rule.py` compares the methods, headers and max age with
  `attachments.tf` on every change.
- **Sign-in** is Keycloak's. Its issuer is the browser's `http://localhost:8082`, which a container
  cannot reach, so the backend fetches its metadata from `http://keycloak:8082`
  (`TASKFEST_OIDC_KEYCLOAK_DISCOVERY_URL`).
- **What it leaves out**: the stream and the scheduled functions, which only Lambda runs. A deleted
  attachment's file stays in the bucket, as nothing there cleans up after it; `down -v` takes it.

**With Podman, build the frontend image with `podman build`.** A Docker CLI whose builder uses the
`docker-container` driver keeps the result in its build cache without loading it, and the stack
then quietly starts whatever older `taskfest-frontend:e2e` it finds.

Always tear it down when finished:

```bash
docker compose -f deployment/docker/docker-compose.e2e.serverless.yml down -v
```

`e2e-serverless.yml` runs this stack on every pull request that touches the Go backend, the
frontend, the suite or Keycloak, as `e2e (Go backend)`. Until #559 `e2e.yml` ran the suite against
the Quarkus backend's stack too, with PostgreSQL and LocalStack; the tag `pre-serverless` keeps it.

See [testing.md](../testing/index.md) for what the suite covers and how to run it interactively.
