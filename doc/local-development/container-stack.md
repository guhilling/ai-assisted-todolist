# Container stack

The production-shaped stack: httpd serving built assets, the backend as a container image,
PostgreSQL with a persistent volume. **No Keycloak**, so sign-in is off unless you supply
real Google credentials.

The backend image is built by Jib rather than from a Dockerfile, so build it first:

```bash
cd backend && ./mvnw package -DskipTests -Dquarkus.container-image.build=true && cd ..
docker compose -f deployment/docker/docker-compose.yml up --build
```

- frontend: `http://localhost:3000`
- backend: `https://localhost:8443` — TLS only, as everywhere the image runs with the `prod` profile
  (#247), with a self-signed certificate made at start, so `curl -k`; the app reaches it through
  httpd
- postgres: `localhost:5432` (`taskfest` / `taskfest` / `taskfest`)

To point this stack at real Google credentials, copy `.env.example` to `.env`, fill it in
and set `QUARKUS_OIDC_ENABLED=true` and `TASKFEST_AUTH_ENABLED=true`. `.env` is git-ignored and
must stay that way.

Tear down with `docker compose -f deployment/docker/docker-compose.yml down`, or `down -v` to discard
the database volume as well.

> **One-off: an existing volume from before the baseline changelog will not start.** The three
> changelogs that built the schema up were squashed into `001-baseline.xml`, so Liquibase finds
> changesets in `databasechangelog` that no longer exist and refuses to continue. Discard the
> volume once and let it rebuild:
>
> ```bash
> docker compose -f deployment/docker/docker-compose.yml down -v
> ```
>
> Nothing else needs doing: `quarkus:dev` and the test suite use Dev Services containers that
> are created fresh each run, and the end-to-end stack is already torn down with `-v`.

