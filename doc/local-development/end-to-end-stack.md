# End-to-end stack

The same stack plus Keycloak and S3, which is what the Playwright suite runs against. Both images
have to exist first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
cd frontend && docker build -f docker/Dockerfile -t taskfest-frontend:e2e . && cd ..

docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait

cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

Both builds are for the machine they run on: on an Apple-silicon Mac the backend's `arm64-image`
profile makes Jib build arm64 (no Rosetta needed), and the published `latest` images carry arm64 as
well (#249). With Podman instead of Docker, add `-Dquarkus.jib.docker-executable-name=podman` to the
backend build.

Here the app is on `http://localhost:3000` with sign-in enabled against Keycloak on
`http://localhost:8082`, so you can also drive it by hand with the accounts above.

**S3 is LocalStack** (#204), with the bucket `taskfest-attachments` and the same CORS rule as in
AWS, created by `e2e/localstack-init.sh`, and signature checks switched on as AWS has them. That
the two rules agree is checked, not hoped for: `.github/scripts/check-cors-rule.py` compares the
methods, headers and max age with `attachments.tf` on every change. It sits
at `http://s3.localhost:4566`, one address for both sides: the backend signs upload and download
links for it, and the browser follows them. The browser resolves every `*.localhost` to 127.0.0.1,
where the port is published; inside the network, `s3.localhost` is an alias of the LocalStack
container. Two names, as with Keycloak, would mean links signed for a host the browser asks
another for, and a signature that no longer matches.

**With Podman, build the frontend image with `podman build`.** A Docker CLI whose builder uses the
`docker-container` driver keeps the result in its build cache without loading it, and the stack
then quietly starts whatever older `taskfest-frontend:e2e` it finds.

Always tear it down when finished — it binds the same ports as the other stacks:

```bash
docker compose -f deployment/docker/docker-compose.e2e.yml down -v
```

## With the Go backend

The same suite runs against the Go backend (#556), which runs beside the Quarkus one while the move
is tried ([architecture.md](../architecture.md#two-architectures)), in a stack of its own,
`docker-compose.e2e.serverless.yml`. Keycloak and the frontend are the Quarkus stack's, by
`extends`; the rest is the Go backend's:

```bash
docker build -t taskfest-serverless:e2e \
  --build-arg GO_VERSION="$(sed -n 's/^go \([0-9.]*\).*/\1/p' serverless/go.mod)" serverless
cd frontend && docker build -f docker/Dockerfile -t taskfest-frontend:e2e . && cd ..

docker compose -f deployment/docker/docker-compose.e2e.serverless.yml up -d --wait

cd e2e && npx playwright test
```

- **The Go server** is `serverless/Dockerfile`: `cmd/api` as a plain HTTP server, the same code
  Lambda runs, built with the toolchain `go.mod` names, passed in as `GO_VERSION`. The frontend proxies `/api/` to it at `http://backend:8080`, which the stack names in
  `TASKFEST_BACKEND_URL`; the frontend image proxies to the Quarkus backend by default.
- **DynamoDB Local** holds the table, in memory, and **SeaweedFS** the attachments, at
  `http://s3.localhost:8333`, one address for both sides as LocalStack's is. LocalStack Community was
  archived in March 2026; SeaweedFS checks a presigned upload's signature, size and type, and the
  bucket's CORS rule, as S3 does, once it has an access key (`e2e/seaweedfs-s3.json`).
  `e2e/serverless-init.sh` creates the table and the bucket, and the bucket's CORS rule, which
  `check-cors-rule.py` compares with AWS's as it does LocalStack's.
- **Sign-in** is Keycloak's, as for Quarkus. Its issuer is the browser's `http://localhost:8082`,
  which a container cannot reach, so the backend fetches its metadata from
  `http://keycloak:8082` (`TASKFEST_OIDC_KEYCLOAK_DISCOVERY_URL`), as Quarkus's `auth-server-url`
  is set apart from its issuer.
- **What it leaves out**: the stream and the scheduled functions, which only Lambda runs. A deleted
  attachment's file stays in the bucket, as nothing there cleans up after it; `down -v` takes it.

```bash
docker compose -f deployment/docker/docker-compose.e2e.serverless.yml down -v
```

`e2e-serverless.yml` runs this stack on every pull request that touches the Go backend, the
frontend, the suite or Keycloak, as `e2e (Go backend)`; `e2e.yml` runs the Quarkus one.

See [testing.md](../testing/index.md) for what the suite covers and how to run it interactively.

