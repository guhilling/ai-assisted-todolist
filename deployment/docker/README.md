# Docker

Compose stacks that wire the application together. Deployment artifacts live here; AWS
material will join them when the target is chosen.

| File | Stack | Sign-in | Open |
| --- | --- | --- | --- |
| `docker-compose.yml` | PostgreSQL, backend, frontend | Off, unless you supply Google credentials | `http://localhost:3000` |
| `docker-compose.e2e.yml` | The same, plus Keycloak | On, against Keycloak on `:8082` | `http://localhost:3000` |

Neither is the best way to *work* on the application — `./mvnw quarkus:dev` is. Full
instructions, including the images both stacks expect to exist, are in
[../doc/local-development.md](../doc/local-development.md).

Two things to know before editing either file:

- **Relative paths resolve against this directory**, so the build contexts and bind mounts
  are `../backend`, `../frontend`, `../keycloak` and `../e2e`.
- **The `name:` at the top is load-bearing.** Without it Compose derives the project name
  from this directory, which would rename the PostgreSQL volume and make each stack treat
  the other's containers as orphans.

The Dockerfiles themselves stay with their modules: `frontend/docker/Dockerfile` builds the
frontend image, and the backend image is built by Jib from `backend/pom.xml` with no
Dockerfile at all.
