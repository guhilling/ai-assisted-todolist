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
6. Backend  exchanges the code, sets q_session, 302 → taskfest.post-login-redirect-uri
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

Every deployment has a **main provider**: Quarkus' default tenant, `quarkus.oidc.*`, pointed at a
different issuer per profile, which signs in at `/api/auth/login`. A deployment may have **further
providers** beside it (#143) — qa gets a Cognito pool with test accounts that automated tests can
sign in with (#190), since Google forbids automating its own sign-in.

| Profile | Issuer | Credentials |
| --- | --- | --- |
| `prod`, `qa` | `https://accounts.google.com` | `TASKFEST_OIDC_GOOGLE_CLIENT_ID` / `_SECRET` from the environment — in AWS, the id from `terraform.tfvars` and the secret from Secrets Manager ([deployment/names-and-certificates.md](deployment/names-and-certificates.md)) |
| `prod`, switched on in qa only: the `cognito` tenant, beside Google | the test accounts' Cognito pool | `TASKFEST_OIDC_COGNITO_*` from the task definition, the secret from SSM. The deployed image runs the `prod` profile in qa and prod alike; the tenant is switched off unless the task definition switches it on, which it does only in qa ([deployment/names-and-certificates.md](deployment/names-and-certificates.md)) |
| `dev`, `test` | Keycloak, started by Dev Services | `taskfest-backend` / `taskfest-secret`, checked in as throwaway values |

Dev and test leave `quarkus.oidc.auth-server-url` unset on purpose — that absence is what
makes Keycloak Dev Services start a container and fill it in.

### Further providers

Each further provider is a **named Quarkus OIDC tenant** plus its entry in the provider list —
configuration, no code:

```properties
# the tenant: issuer, client, and its own two paths -- where sign-in starts, and its callback
quarkus.oidc.<id>.auth-server-url=…
quarkus.oidc.<id>.client-id=…
quarkus.oidc.<id>.credentials.secret=…
quarkus.oidc.<id>.tenant-paths=/api/auth/login/<id>,/api/auth/callback/<id>
quarkus.oidc.<id>.authentication.redirect-path=/api/auth/callback/<id>
# what every provider shares with the main one -- a named tenant inherits nothing, so each is a
# reference to the main tenant's value and cannot drift from it
quarkus.oidc.<id>.application-type=${quarkus.oidc.application-type}
quarkus.oidc.<id>.authentication.restore-path-after-redirect=${quarkus.oidc.authentication.restore-path-after-redirect}
quarkus.oidc.<id>.authentication.scopes=${quarkus.oidc.authentication.scopes}
quarkus.oidc.<id>.authentication.cookie-same-site=${quarkus.oidc.authentication.cookie-same-site}
quarkus.oidc.<id>.authentication.cookie-force-secure=${quarkus.oidc.authentication.cookie-force-secure}
quarkus.oidc.<id>.authentication.java-script-auto-redirect=${quarkus.oidc.authentication.java-script-auto-redirect}
quarkus.oidc.<id>.authentication.session-age-extension=${quarkus.oidc.authentication.session-age-extension}
quarkus.oidc.<id>.token-state-manager.strategy=${quarkus.oidc.token-state-manager.strategy}
quarkus.oidc.<id>.token.refresh-expired=${quarkus.oidc.token.refresh-expired}
# the button
taskfest.auth.providers.<id>.label=…
taskfest.auth.providers.<id>.client-id=…
taskfest.auth.providers.<id>.client-secret=…
```

- **Every provider has its own paths, and the path decides who answers.** The main provider's are
  `/api/auth/login` and `/api/auth/callback` (`quarkus.oidc.tenant-paths`); a further provider's
  are `/api/auth/login/<id>` and `/api/auth/callback/<id>`. A shared callback was resolved by
  whichever provider's cookie Quarkus happened to read first, so an abandoned sign-in with one
  provider could break a sign-in with another. The provider list reports each provider's login
  path as its `loginUrl`, read from `tenant-paths`, so it is written down once (`SignInProviders`).
- **One provider at a time.** A tenant's session lives in `q_session_<id>` (the main one's in
  `q_session`), encrypted with that tenant's secret; presented under another's name it is refused,
  not read. When a sign-in completes, the other providers' sessions and any stale state cookies
  (`q_auth*`) are expired — a browser holding two sessions would otherwise be one person or the
  other, depending on cookie order.
- **Sign-out ends every session**, since it expires every cookie starting with `q_session`.
- **Mistakes fail loudly.** More than one usable provider without a tenant of its own stops the
  start-up — only one can be the main provider, so a forgotten or misspelt `tenant-paths` would
  otherwise give a button that signs in with the main provider. A request for
  `/api/auth/login/<id>` naming no provider is a 404, answered before authentication could fall
  back to the main provider.
- **`cookie-force-secure` is among the shared settings for a reason.** In qa and prod the main
  tenant forces the `Secure` flag, because TLS ends at the load balancer and the backend sees
  plain HTTP; a tenant without it would send its session cookies without `Secure`.

`MultiProviderSignInTest` proves all of this against a second Keycloak realm
(`backend/src/test/resources/realm-other.json`), declared in `TwoSignInProviders` exactly as above,
and checks that every shared setting of the second tenant equals the main one's.

### Every provider must vouch for the email

The email is the identity: with more than one provider, the same address from either means the
same person. So **a sign-in is refused unless the provider says the address is verified**
(`email_verified` in the ID token) — otherwise a provider that hands out unchecked addresses could
sign someone in as another person's account. `VerifiedEmail` enforces it for every tenant;
Quarkus' own `token.required-claims` cannot, because it compares strings and the claim is a
boolean at Google and Keycloak (Cognito has sent the string `"true"`, which is accepted too).
Adding a provider therefore means trusting it with that claim — see
[decisions/authentication.md](decisions/authentication.md).

## The provider list

`GET /api/auth/providers` drives the signed-out screen. A provider is advertised as usable
purely because configuration gave it a client id and secret:

```java
boolean available = authProvidersConfig.enabled()
    && isPresent(entry.getValue().clientId())
    && isPresent(entry.getValue().clientSecret());
```

No provider name appears in the code, on either side. Adding one is a configuration change:
a `taskfest.auth.providers.<id>.*` block appears and a sign-in button appears with it — for a
provider beside the main one, together with its tenant (above). Dev and test declare `keycloak`;
the deployed image declares `google`, and `cognito` switched off unless qa's task definition
switches it on. **A provider whose tenant is switched off is not part of the deployment at all**:
it is left out of the list, can never be the main provider, and its path is a 404 — so prod's list
holds Google alone.

A declared provider without credentials is **still reported**, with `available: false` and a
null `loginUrl` — but the frontend **hides** it rather than showing it disabled, so a fresh
production deployment shows no Google button at all until its secrets are supplied, and says
sign-in is not configured. The endpoint reports it anyway so that a caller can tell a
provider that exists but is unconfigured from one that was never declared; see
[decisions/frontend.md](decisions/frontend.md#the-board-is-the-front-page-the-project-description-is-a-link).

## Local accounts

`keycloak/realm-taskfest.json` is imported by both Dev Services and the end-to-end stack,
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

`taskfest.gravatar.enabled=false` switches it off entirely, which is what the test profile does so
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
- `MultiProviderSignInTest` — two providers at once: sign-in through each, the session kept per
  provider and refused under another's name, one provider at a time, an abandoned sign-in with one
  not breaking the other, an unknown provider refused with a 404, the shared settings equal, and an
  unverified address refused. `ProviderInLogsTest` checks the log lines name the provider;
  `SignInProvidersTest` and `VerifiedEmailTest` are the plain unit tests behind it.
- `KeycloakLoginFlowTest` — the real authorization code flow against Dev Services Keycloak:
  follow the redirect, post the Keycloak login form, land on the callback, then use the API
  with the resulting session. It also proves two real accounts cannot see each other's
  tasks.
- `e2e/tests/login.spec.ts` — the same journey in a real browser through httpd.

See [testing.md](testing/index.md).
