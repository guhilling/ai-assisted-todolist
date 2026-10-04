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
1. Browser  GET /api/auth/providers          → the sign-in options for the signed-out page
2. Browser  GET /api/auth/login              (full-page navigation, not fetch)
3. Backend  302 → provider /authorize?...redirect_uri=<origin>/api/auth/callback
4. Provider shows its login form; user authenticates
5. Provider 302 → <origin>/api/auth/callback?code=...&state=...
6. Backend  exchanges the code, sets q_session, 302 → todo.post-login-redirect-uri
7. Browser  GET /api/auth/me                 → { "email": "..." }
```

Steps 2 and 5 are browser navigations. That is why the sign-in control is a link rather than a
button with an `onClick` — a `fetch` cannot follow a cross-origin redirect into a login
form.

`/api/auth/login` carries no logic at all: it is annotated `@Authenticated`, and the
security layer intercepts the unauthenticated request and starts the flow before the
method body is ever reached. The body only runs on the way back, to redirect to the app.

## How long a session lasts

Google's ID token is valid for an hour. The backend asks Google for **offline access**
(`access_type=offline`, in `prod` and `qa`), so the session also holds a refresh token, and once
the ID token has expired Quarkus renews it silently on the next request
(`quarkus.oidc.token.refresh-expired`). The session cookie lives **eight hours** beyond the
token's expiry (`quarkus.oidc.authentication.session-age-extension`), and every renewal moves
that on — so a session ends after eight hours **without a request**, not an hour after signing
in. Keycloak, locally, issues refresh tokens without being asked.

When a session has ended, the frontend notices on whichever request comes first — a 401, or the
499 Quarkus answers a script that asked not to be redirected — and shows "Your session has
expired" above the sign-in options instead of an error message (`SessionExpiredError` in
`api.ts`). Signing in again is a full page navigation, so anything typed but not saved is lost;
the notice at least says why.

Google issues a refresh token only when access is granted with offline access included. An
account that had signed in before this was asked for may keep getting sessions that end after an
hour until it grants access again: removing the app under *Third-party apps with account access*
in the Google account and signing in once more does that.

## Sign-out

`/api/auth/logout` expires the session cookies by hand and redirects. Note the plural:
Quarkus splits the session across `q_session_chunk_1`, `q_session_chunk_2` and so on once the
encrypted tokens outgrow the 4 KB a single cookie holds, and whether it does that depends on
how large the tokens happen to be on the day. Expiring only `q_session` therefore worked or
silently did nothing from run to run, which showed up as an end-to-end test that "frequently"
failed on sign-out. The endpoint now expires every cookie whose name starts with `q_session`.

It is deliberately **not** an
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
| `prod`, `qa` | `https://accounts.google.com` | `TODO_OIDC_GOOGLE_CLIENT_ID` / `_SECRET` from the environment — in AWS, the id from `terraform.tfvars` and the secret from Secrets Manager ([deployment/names-and-certificates.md](deployment/names-and-certificates.md)) |
| `dev`, `test` | Keycloak, started by Dev Services | `todolist-backend` / `todolist-secret`, checked in as throwaway values |

Dev and test leave `quarkus.oidc.auth-server-url` unset on purpose — that absence is what
makes Keycloak Dev Services start a container and fill it in.

## The provider list

`GET /api/auth/providers` drives the signed-out screen. A provider is advertised as usable
purely because configuration gave it a client id and secret:

```java
boolean available = authProvidersConfig.enabled()
    && isPresent(entry.getValue().clientId())
    && isPresent(entry.getValue().clientSecret());
```

No provider name appears in the code, on either side. Adding one is a configuration change:
a `todo.auth.providers.<id>.*` block appears and a sign-in button appears with it. In
production only `google` is declared; dev and test add `keycloak`.

A declared provider without credentials is **still reported**, with `available: false` and a
null `loginUrl` — but the frontend **hides** it rather than showing it disabled, so a fresh
production deployment shows no Google button at all until its secrets are supplied, and says
sign-in is not configured. The endpoint reports it anyway so that a caller can tell a
provider that exists but is unconfigured from one that was never declared; see
[decisions/frontend.md](decisions/frontend.md#the-board-is-the-front-page-the-project-description-is-a-link).

## Local accounts

`keycloak/realm-todolist.json` is imported by both Dev Services and the end-to-end stack,
so the same realm backs local runs and CI:

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `jboss.gunnar@hilling.de` |
| `lasse` | `lasse` | `lasse@example.com` |

The email claim is not optional decoration — it *is* the identity, so a realm user without
one would fail on their first request. See [domain-model.md](domain-model.md).

These credentials are testing-only placeholders and belong in the repository. Real secrets
never do.

## What the browser learns about you

`GET /api/auth/me` answers with three fields, and only the first is identity:

| Field | Where it comes from | Absent when |
| --- | --- | --- |
| `email` | the `email` claim | never — a user without one fails on their first request |
| `name` | the `name` claim | the provider supplied none |
| `pictureUrl` | the `picture` claim, else a Gravatar the backend has confirmed exists | neither is available |

**The name and picture are not stored.** They are read from the token on each request and
live only as long as the session. That is why adding them needed no migration and cannot go
stale: the email remains the whole of the identity, which is what `User` is keyed by and what
ownership is decided on. A consequence worth knowing: because nothing is persisted, a name can
only ever be shown to its own owner. Anything that had to display one user's name to another —
sharing, an audit trail — would have to revisit that.

Both require the `profile` scope, which is why
`quarkus.oidc.authentication.scopes=email,profile` is now set for every profile rather than
only for dev and test. These are non-sensitive scopes; Google needs no verification review for
them, and `picture` arrives with `profile` rather than being a permission of its own.

### The Gravatar fallback

Consulted **only** when the provider sent no `picture`. Google almost always does; Keycloak
here never does, which keeps this path exercised locally rather than only in production.

The backend makes the request rather than the browser, so that "if an image is available" is
actually answered — `?d=404` is what makes Gravatar say no instead of inventing a picture.
**This does not make the browser's request go away**: the page still loads the image from
gravatar.com, so a third party still sees the reader's address and a hash of their email. What
the server-side check buys is a truthful answer, not privacy. [decisions/authentication.md](decisions/authentication.md) records that
rather than leaving it implied.

Two things stop it becoming a liability on the sign-in path. The result is **cached** by
address, because `/api/auth/me` runs on every page load and would otherwise mean an outbound
request on every page load. And **failure is not an error**: a slow or unreachable Gravatar
yields no picture and sign-in carries on. Nobody should be locked out of their tasks because
an avatar service is having a bad day.

`todo.gravatar.enabled=false` switches it off entirely, which is what the test profile does so
that no `@QuarkusTest` reaches the internet.

## Configuration that is load-bearing

Four settings look innocuous and are not. Each was found the hard way, by nobody being
able to sign in.

- **`quarkus.oidc.token-state-manager.strategy=keep-all-tokens`.** The `id-refresh-tokens`
  strategy drops the access token, and restoring such a session throws a
  `NullPointerException` inside Quarkus OIDC — every request after a *successful* sign-in
  came back 401.
- **`quarkus.jib.base-jvm-image` pinned to a Temurin 25 build.** Jib's default base ships
  JDK 21; this code is compiled for 25, so the container exited immediately and silently.
- **`changeOrigin: false` in `vite.config.ts`, `ProxyPreserveHost On` in httpd.** Both
  proxies default to rewriting the `Host` header. The backend builds `redirect_uri` from it,
  so sign-in dumped the browser on the backend's port instead of returning it to the app.
- **`LimitRequestFieldSize 32768` in httpd.** The session cookie carries encrypted tokens
  and is chunked across `q_session_chunk_1`, `_2` and so on, all of which come back in one
  `Cookie` header — about 5.2 KB today against Apache's 8190-byte default. That fits, and
  the limit is raised for headroom rather than to fix a current break, because the size
  depends on the provider's claims. Under nginx the equivalent buffers genuinely did have to
  be raised, which is the same reason the cookie is chunked and sign-out clears every chunk.

## What is tested

- `AuthProviderResourceTest` — with authentication off, no provider is ever offered as
  clickable.
- `KeycloakLoginFlowTest` — the real authorization code flow against Dev Services Keycloak:
  follow the redirect, post the Keycloak login form, land on the callback, then use the API
  with the resulting session. It also proves two real accounts cannot see each other's
  tasks.
- `e2e/tests/login.spec.ts` — the same journey in a real browser through httpd.

See [testing.md](testing/index.md).
