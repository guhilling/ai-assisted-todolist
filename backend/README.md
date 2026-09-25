# backend

The Quarkus REST API: task and user persistence on PostgreSQL, and the OpenID Connect
client that performs sign-in on the frontend's behalf.

```bash
./mvnw quarkus:dev   # dev mode; starts PostgreSQL and Keycloak via Dev Services
./mvnw verify        # tests, coverage and Checkstyle
./mvnw package -DskipTests -Dquarkus.container-image.build=true   # build the image (Jib)
```

Dev mode serves the API on `http://localhost:8080`, the Dev UI at `/q/dev/`, OpenAPI at
`/q/openapi` and Prometheus metrics at `/q/metrics`.

Conventions for working here — testing strategy, TDD, code style, logging, Javadoc — are in
[CLAUDE.md](CLAUDE.md). Project documentation is in [../doc](../doc); start with
[architecture.md](../doc/architecture.md) and [domain-model.md](../doc/domain-model.md).

The Dockerfiles under `src/main/docker/` are unused Quarkus scaffolding and are JDK 17
based. The published image is built by Jib onto a pinned Java 25 base.
