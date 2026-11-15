# Docker

The Compose stack that wires the application together for the end-to-end tests. Deployment
artifacts live here; the AWS infrastructure is in [../aws-tofu](../aws-tofu).

| File | Stack | Sign-in | Open |
| --- | --- | --- | --- |
| `docker-compose.e2e.serverless.yml` | The Go backend (#556), DynamoDB Local, SeaweedFS for S3, Keycloak, frontend | On, against Keycloak on `:8082` | `http://localhost:3000` |

It is not the best way to *work* on the application — `go run ./cmd/api` against the stack's
stores is ([serverless.md](../../doc/deployment/serverless.md)), with the frontend's `npm run dev`.
Full instructions, including the images the stack expects to exist, are in
[end-to-end-stack.md](../../doc/local-development/end-to-end-stack.md).

Two things to know before editing the file:

- **Relative paths resolve against this directory**, so the bind mounts are `../../keycloak` and
  `../../e2e`.
- **The `name:` at the top is load-bearing.** Without it Compose derives the project name from
  this directory, and any other stack started from here would treat this one's containers as
  orphans.

The Dockerfiles themselves stay with their modules: `frontend/docker/Dockerfile` builds the
frontend image, `serverless/Dockerfile` the Go backend's for the local stack. The Quarkus
backend's stacks, the local container stack and the monitoring overlay, went with it (#559); the
tag `pre-serverless` keeps them.
