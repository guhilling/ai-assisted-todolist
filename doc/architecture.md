# Architecture

## The pieces

Three deployable components and one external dependency:

| Component | What it is | Where it lives |
| --- | --- | --- |
| Frontend | React 19 + TypeScript single-page app, served as static files by Apache httpd | `frontend/` |
| Backend | Quarkus 3.25 REST API on Java 25, also the OIDC client | `backend/` |
| Database | PostgreSQL 17, schema managed by Liquibase | — |
| Identity provider | Google in production; a Keycloak container in development and tests | `keycloak/` |

## How a request travels

```
browser ──▶ httpd ──▶ Quarkus ──▶ PostgreSQL
            (static files, and a
             reverse proxy for /api)
```

In production the browser talks to a single origin. httpd serves the built assets on
`:8080` and proxies everything under `/api` to the backend, so the SPA makes same-origin
requests and needs no CORS handling and no API base URL. In development Vite's dev server
plays the same role: it serves the app on `:5173` and proxies `/api` to the backend on
`:8080`.

Both proxies must preserve the original `Host` header — Vite with `changeOrigin: false`,
httpd with `ProxyPreserveHost On`. The backend builds the OIDC `redirect_uri` from that
header, so a rewritten host sends the browser to the wrong port after sign-in.

`FallbackResource /index.html` is what makes a deep link work: any path that is not a real
file is a route the app resolves, not a 404. It is scoped to the document root, and
`ProxyPass` is matched first, so an unknown `/api` path still returns the backend's own 404
rather than the index page.

## Why the backend is a backend-for-frontend

The backend is the OIDC *client*, not a resource server that validates bearer tokens the
frontend obtained for itself. Quarkus OIDC runs in `web-app` mode: the backend performs
the authorization code exchange and keeps the resulting tokens in the encrypted
`q_session` cookie. The frontend never holds a token, and never sees one.

The consequences are worth stating, because they explain several shapes elsewhere:

- The frontend's only notion of identity is `GET /api/auth/me`, which returns an email.
- Sign-in is a full-page navigation to `/api/auth/login`, not a fetch — the flow needs
  redirects the browser follows itself.
- `fetch` calls send `X-Requested-With: JavaScript`, which the backend pairs with
  `quarkus.oidc.authentication.java-script-auto-redirect=false` to answer 401 instead of
  redirecting a background request.

[authentication.md](authentication.md) covers the flow in detail.

## Backend structure

Three packages, and no more layering than the application earns:

- `api` — JAX-RS resources. Each owns its own request and response records, so the
  persistence entities never reach the wire.
- `model` — Panache active-record entities and the domain enums. See
  [domain-model.md](domain-model.md).
- `service` — the little application logic that is not a resource concern. Currently only
  `UserService`, which owns the create-a-user-on-first-sight rule.

Panache active records mean entities expose public fields and carry their own queries.
That is idiomatic Quarkus rather than an encapsulation lapse: Hibernate rewrites field
access into accessor calls at build time. It is why Checkstyle's `VisibilityModifier`
check is switched off here.

## API documentation

Every JAX-RS resource carries MicroProfile OpenAPI annotations (`@Tag`, `@Operation`,
`@APIResponse`), and the request/response records carry `@Schema` examples, so the
generated spec has real descriptions and sample payloads rather than bare paths. Two ways
to see it:

- Live, including Swagger UI's interactive "Try it out": `./mvnw quarkus:dev`, then
  `http://localhost:8080/q/swagger-ui` (the raw spec is at `/q/openapi`).
- As a file: every build writes `target/openapi/openapi.yaml`
  (`quarkus.smallrye-openapi.store-schema-directory`), and every GitHub Release attaches
  that file as a downloadable asset.

## Schema management

Liquibase owns the schema; Hibernate is set to `validate` and never generates DDL. Every
schema change is its own changelog under `backend/src/main/resources/db/changes/`, checked
in with the code that needs it, and applied at startup by
`quarkus.liquibase.migrate-at-start`. The application therefore fails fast on a schema it
does not recognise rather than quietly adapting to it.

## Configuration

One `application.properties` with profile prefixes (`%prod.`, `%dev,test.`, `%qa.`) rather
than separate files per environment, so the differences between environments are visible
side by side. Secrets are never checked in: production reads Google credentials from
environment variables, and `.env.example` documents which ones. The dev and test profiles
need no secrets at all, because they point at a local Keycloak with throwaway credentials.

Dev and test deliberately leave the datasource URL and the OIDC issuer *unset*, which is
what makes Quarkus Dev Services start PostgreSQL and Keycloak automatically.

## Containers and deployment

The backend image is built by **Jib** rather than from a Dockerfile — `./mvnw package
-Dquarkus.container-image.build=true` — on an explicitly pinned `eclipse-temurin:25-jre`
base. The pin matters: Jib's default base ships JDK 21 and cannot load this code's class
files. There are no Dockerfiles under `backend/` at all: the four Quarkus generated were
unused, two of them JDK 17 based, and all four were deleted.

The frontend image is a two-stage Dockerfile at `frontend/docker/Dockerfile`: build with
Node, serve with httpd.

`docker/` holds the Compose stacks that wire these together —
[local-development.md](local-development.md) describes both. AWS is the intended
deployment target, and `docker/` is where that material will land once the target is
chosen. Nothing about the application assumes it: it is a stateless container reading its
configuration from the environment, plus a PostgreSQL it connects to by URL.
