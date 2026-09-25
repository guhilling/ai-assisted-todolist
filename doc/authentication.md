# Authentication

## The shape: backend-for-frontend

The backend is the OIDC **client**. It performs the authorization code exchange itself and
keeps the resulting tokens server-side, inside the encrypted `q_session` cookie that
Quarkus OIDC's `web-app` application type manages. The single-page app never obtains,
holds or sends a token — it sends a cookie, like any classic web session.

This was chosen over the more common "SPA gets a token, backend validates the bearer"
arrangement because tokens in browser storage are the part of that design that goes wrong,
and because a browser session is simply less machinery for an app with one origin.

## The flow

```
1. Browser  GET /api/auth/providers          → the cards to show while signed out
2. Browser  GET /api/auth/login              (full-page navigation, not fetch)
3. Backend  302 → provider /authorize?...redirect_uri=<origin>/api/auth/callback
4. Provider shows its login form; user authenticates
5. Provider 302 → <origin>/api/auth/callback?code=...&state=...
6. Backend  exchanges the code, sets q_session, 302 → todo.post-login-redirect-uri
7. Browser  GET /api/auth/me                 → { "email": "..." }
```

Steps 2 and 5 are browser navigations. That is why the sign-in card is a link rather than a
button with an `onClick` — a `fetch` cannot follow a cross-origin redirect into a login
form.

`/api/auth/login` carries no logic at all: it is annotated `@Authenticated`, and the
security layer intercepts the unauthenticated request and starts the flow before the
method body is ever reached. The body only runs on the way back, to redirect to the app.

## Sign-out

`/api/auth/logout` expires `q_session` by hand and redirects. It is deliberately **not** an
RP-initiated logout, so the identity provider's own session survives: signing out and back
in will not prompt for credentials again. This matters for tests — the Playwright suite
opens a fresh `browser.newContext()` per account, because reusing one would silently sign
the second account in as the first.

## Which provider, where

`quarkus.oidc.*` configures exactly one tenant, pointed at a different issuer per profile.
There is no Quarkus multi-tenancy, because Google and Keycloak never need to be live
simultaneously.

| Profile | Issuer | Credentials |
| --- | --- | --- |
| `prod`, `qa` | `https://accounts.google.com` | `TODO_OIDC_GOOGLE_CLIENT_ID` / `_SECRET` from the environment |
| `dev`, `test` | Keycloak, started by Dev Services | `todolist-backend` / `todolist-secret`, checked in as throwaway values |

Dev and test leave `quarkus.oidc.auth-server-url` unset on purpose — that absence is what
makes Keycloak Dev Services start a container and fill it in.

## The provider cards

`GET /api/auth/providers` drives the signed-out screen. A provider is advertised as
clickable purely because configuration gave it a client id and secret:

```java
boolean available = authProvidersConfig.enabled()
    && isPresent(entry.getValue().clientId())
    && isPresent(entry.getValue().clientSecret());
```

No provider name appears in the code, on either side. Adding one is a configuration change:
a `todo.auth.providers.<id>.*` block appears and a card appears with it. In production only
`google` is declared; dev and test add `keycloak`. A declared provider without credentials
renders as a disabled card, which is exactly what a fresh production deployment shows
before its Google secrets are supplied.

## Local accounts

`keycloak/realm-todolist.json` is imported by both Dev Services and the end-to-end stack,
so the same realm backs local runs and CI:

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `gunnar@example.com` |
| `lasse` | `lasse` | `lasse@example.com` |

The email claim is not optional decoration — it *is* the identity, so a realm user without
one would fail on their first request. See [domain-model.md](domain-model.md).

These credentials are testing-only placeholders and belong in the repository. Real secrets
never do.

## Configuration that is load-bearing

Four settings look innocuous and are not. Each was found the hard way, by nobody being
able to sign in.

- **`quarkus.oidc.token-state-manager.strategy=keep-all-tokens`.** The `id-refresh-tokens`
  strategy drops the access token, and restoring such a session throws a
  `NullPointerException` inside Quarkus OIDC — every request after a *successful* sign-in
  came back 401.
- **`quarkus.jib.base-jvm-image=eclipse-temurin:25-jre`.** Jib's default base ships JDK 21;
  this code is compiled for 25, so the container exited immediately and silently.
- **`changeOrigin: false` in `vite.config.ts`, `proxy_set_header Host $http_host` in
  nginx.** Both proxies default to rewriting the `Host` header. The backend builds
  `redirect_uri` from it, so sign-in dumped the browser on the backend's port instead of
  returning it to the app.
- **`proxy_buffer_size 16k` and friends in nginx.** The session cookie carries encrypted
  tokens and exceeds the default 4 KB header buffer, turning the callback into a 502.

## What is tested

- `AuthProviderResourceTest` — with authentication off, no provider is ever offered as
  clickable.
- `KeycloakLoginFlowTest` — the real authorization code flow against Dev Services Keycloak:
  follow the redirect, post the Keycloak login form, land on the callback, then use the API
  with the resulting session. It also proves two real accounts cannot see each other's
  tasks.
- `e2e/tests/login.spec.ts` — the same journey in a real browser through nginx.

See [testing.md](testing.md).
