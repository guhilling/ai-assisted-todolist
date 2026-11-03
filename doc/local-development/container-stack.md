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

To point this stack at real Google credentials, copy `.env.example` to `.env` at the repository's
root, fill in the Google client and set `TASKFEST_AUTH_ENABLED=true`. The backend reads that file
when it exists (its `env_file`, which is optional); without it, sign-in is off. `.env` is
git-ignored and must stay that way.

- **Fill in a Google value or delete its line, but never leave it empty.** A variable set to
  nothing is not a missing one: Quarkus keeps the empty value instead of its default, and an empty
  client id stops the backend from starting (#511). For the same reason the Compose files give no
  variable an empty default, which `.github/scripts/check-compose-env.py` checks in Docs CI.
- **`QUARKUS_OIDC_ENABLED` changes nothing here.** It is fixed when the image is built, so the
  image always has OIDC on; `TASKFEST_AUTH_ENABLED` is what turns sign-in on and off.

Tear down with `docker compose -f deployment/docker/docker-compose.yml down`, or `down -v` to discard
the database volume as well.

The database volume is mounted at `/var/lib/postgresql`, where PostgreSQL 18's image keeps one
directory per major version; on the older `/var/lib/postgresql/data` it refuses to start, even with
an empty volume. A volume that still holds data from an older PostgreSQL makes it refuse too:
discard it with `down -v`, or upgrade it with `pg_upgrade`.

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

