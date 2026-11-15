# Authentication

How TaskFest signs people in: the website through the backend, with a session the backend keeps,
and the apps with a bearer ID token. The code is `serverless/internal/auth`, with the sessions'
storage in `serverless/internal/store/sessions.go`. It keeps the paths, providers and rules of the
Quarkus backend it replaced, which the tag `pre-serverless` holds; what differs from it, and why,
is in [serverless.md](deployment/serverless.md#sign-in).

## The shape: backend-for-frontend

The backend is the OIDC **client**. It performs the authorization code exchange itself, verifies
the ID token it gets, and then keeps nothing of the provider's tokens: the session is an item in
DynamoDB holding who signed in, and the browser holds only a cookie with a random value whose
SHA-256 is that item's key. The single-page app never obtains, holds or sends a token — it sends a
cookie, like any classic web session. (The mobile app cannot, and sends a bearer ID token instead:
[Apps sign in with a bearer ID token](#apps-sign-in-with-a-bearer-id-token).)

This was chosen over the more common "SPA gets a token, backend validates the bearer"
arrangement because tokens in browser storage are the part of that design that goes wrong,
and because a browser session is simply less machinery for an app with one origin
([decisions/authentication.md](decisions/authentication.md#backend-for-frontend-authentication)).

## The flow

```
1. Browser  GET /api/auth/providers          → the sign-in options for the signed-out page
2. Browser  GET /api/auth/login              (full-page navigation, not fetch)
3. Backend  stores the sign-in under way, sets taskfest_signin,
            302 → provider /authorize?...state=...&nonce=...&code_challenge=...
                  &redirect_uri=<origin>/api/auth/callback
4. Provider shows its login form; user authenticates
5. Provider 302 → <origin>/api/auth/callback?code=...&state=...
6. Backend  checks the state, exchanges the code with the PKCE verifier, verifies the ID token,
            stores the session, sets taskfest_session, 303 → the post-login redirect
7. Browser  GET /api/auth/me                 → { "email": "...", "name": ..., "pictureUrl": ... }
```

Steps 2 and 5 are browser navigations. That is why the sign-in control is a link rather than a
button with an `onClick` — a `fetch` cannot follow a cross-origin redirect into a login
form.

`Service.Login` starts the flow and `Service.Callback` finishes it (`internal/auth/service.go`).
The callbacks are routed in `internal/api/server.go` beside the generated routes, since only a
provider calls them and the contract leaves them out.

- **Step 3** makes three random values: the `state`, a `nonce`, and a PKCE verifier, whose S256
  challenge goes to the provider. The verifier and nonce are stored as the item `SIGNIN#<SHA-256
  of the state>`, which lasts ten minutes, and the state goes into the `taskfest_signin` cookie
  for the same ten minutes. A browser that is already signed in is sent straight back to the app.
- **Step 6** refuses the callback unless the `state` equals the browser's own cookie, and takes
  the stored sign-in in the same step as it reads it, so a callback works once. The code is
  exchanged with that sign-in's verifier, and the ID token is checked as a bearer token is (below),
  but for the backend's own client alone and with the nonce it was given. The backend asks for the
  scopes `openid email profile`.
- **A refused callback goes back to the app**, signed out, which offers sign-in again: a second
  tab's sign-in, a callback used twice or a sign-in cancelled at the provider would otherwise end on
  a blank page. The log says why, and the `taskfest_signin` cookie is cleared.
- **The post-login redirect** is `TASKFEST_AUTH_POST_LOGIN_REDIRECT_URI`, `/` by default, and is
  where sign-out goes too.

## How long a session lasts

A session ends after **eight hours without a request**, and in any case **seven days after
signing in** (`IdleLifetime`, `AbsoluteLifetime`). It is never renewed with the provider: no
refresh token is asked for or kept, so nothing happens when the provider's ID token runs out after
its hour. A busy session records its latest request at most every five minutes, which is all an
eight-hour limit needs. The item carries `expiresAt`, the table's TTL attribute, and the backend
checks both times on every read as well, since TTL deletes late
([serverless.md](deployment/serverless.md#sign-in) has the reasons, Gunnar's decisions on #549).

When a session has ended, the frontend notices on whichever request comes first — the backend
answers 401 — and shows "Your session has expired" above the sign-in options instead of an error
message (`SessionExpiredError` in `frontend/src/api.ts`). Signing in again is a full page
navigation, so anything typed but not saved is lost; the notice at least says why.

## The cookies

| Cookie | Holds | Lasts |
| --- | --- | --- |
| `taskfest_session` | the session's random value, 32 bytes | seven days; the server ends it sooner |
| `taskfest_signin` | the `state` of a sign-in under way | ten minutes, cleared at the callback |

Both are `HttpOnly`, `SameSite=Lax` and on the path `/`, and `Secure` everywhere but where
`TASKFEST_COOKIE_SECURE=false` says the site is plain HTTP, which only the local stacks do. The
table stores only each value's SHA-256, so nothing in it lets anyone in. Signing in or out also
expires any `q_session…` and `q_auth…` cookie a browser still holds from the Quarkus backend.

## Sign-out

`GET /api/auth/logout` deletes the session's item, and its link from the user's partition, expires
the cookie, and redirects to the post-login redirect (`Service.Logout`). Since the session lives on
the server, a copy of the cookie stops working too.

It is deliberately **not** an
RP-initiated logout, so the identity provider's own session survives: signing out and back
in will not prompt for credentials again. This matters for tests — the Playwright suite
opens a fresh `browser.newContext()` per account, because reusing one would silently sign
the second account in as the first.

Deleting the account ends its sessions on every device, through the links each sign-in writes into
the user's partition ([serverless.md](deployment/serverless.md#deleting-an-account)).

## Which provider, where

Every deployment has a **main provider**, which signs in at `/api/auth/login`, and may have
**further providers** beside it (#143) — qa gets a Cognito pool with test accounts that automated
tests can sign in with (#190), since Google forbids automating its own sign-in. The main provider
is the first in `TASKFEST_AUTH_PROVIDERS`.

| Where | Providers | Credentials |
| --- | --- | --- |
| prod | `google` | the client id from `terraform.tfvars`; the secret from Secrets Manager, named by `TASKFEST_OIDC_GOOGLE_CLIENT_SECRET_ARN` and read once per cold start (`internal/secrets`) ([deployment/names-and-certificates.md](deployment/names-and-certificates.md)) |
| qa | `google`, and `cognito` beside it (`test_sign_in = true`) | Google's as in prod; the test accounts' pool and client are made by `deployment/aws-tofu/modules/environment/test-sign-in.tf`, which puts the client's id and secret in the function's settings |
| the local stacks | `keycloak` | `taskfest-backend` / `taskfest-secret`, checked in as throwaway values |

`deployment/aws-tofu/modules/environment/serverless.tf` writes these settings. An environment with
no Google client id has sign-in switched off: `TASKFEST_AUTH_ENABLED` is false and no provider is
declared.

### The settings

Every provider is configuration, no code (`auth.LoadConfig` in `internal/auth/config.go`):

```sh
TASKFEST_AUTH_ENABLED=true               # off: providers are listed, none is usable
TASKFEST_AUTH_PROVIDERS=google,cognito   # the ids, the main provider first
TASKFEST_OIDC_<ID>_LABEL=…               # the button; the id when left out
TASKFEST_OIDC_<ID>_ISSUER=…              # exactly as the ID tokens' iss spells it
TASKFEST_OIDC_<ID>_DISCOVERY_URL=…       # where its metadata is, when not at the issuer
TASKFEST_OIDC_<ID>_CLIENT_ID=…
TASKFEST_OIDC_<ID>_CLIENT_SECRET=…       # or _CLIENT_SECRET_ARN, a Secrets Manager secret
TASKFEST_OIDC_<ID>_AUDIENCES=…           # further client ids a bearer token may be issued to
```

`<ID>` is the id in upper case, with `-` as `_`.

- **Every provider has its own paths, and the path decides who answers.** The main provider's are
  `/api/auth/login` and `/api/auth/callback`; a further provider's are `/api/auth/login/<id>` and
  `/api/auth/callback/<id>`. A sign-in under way remembers its provider, so a callback at another
  provider's path is refused, and an abandoned sign-in with one cannot break a sign-in with
  another. The provider list reports each provider's login path as its `loginUrl`
  (`Provider.LoginPath`).
- **One session per browser.** There is one session cookie whatever the provider, and a browser
  that is signed in and asks to sign in again goes straight back to the app.
- **Mistakes fail loudly.** A provider without an issuer, an id that cannot be part of a path
  (longer than 64 characters, or with `/`, `?` or `#`), and two ids that would read the same
  settings stop the start. A path naming no usable provider is a 404: an unknown id, the main
  provider's id under `/api/auth/login/<id>`, a provider without its client's id and secret, and
  every path while sign-in is switched off.
- **`Secure` is one setting for every cookie**, so no provider can send its session without it.
- **The redirect URI is the public origin plus the callback path.** In AWS that is
  `TASKFEST_PUBLIC_ORIGIN`, since behind CloudFront and API Gateway the request's `Host` is API
  Gateway's; without it, as from source, it is the request's own `Host`, and `https` where
  `X-Forwarded-Proto` says so.

### Every provider must vouch for the email

The email is the identity: with more than one provider, the same address from either means the
same person. So **a sign-in is refused unless the provider says the address is verified**
(`email_verified` in the ID token) — otherwise a provider that hands out unchecked addresses could
sign someone in as another person's account. `verifyIDToken` in `internal/auth/tokens.go` enforces
it for every provider, at the callback and for bearer tokens alike, and refuses a token without an
email. The claim is the boolean `true` at Google and Keycloak; Cognito has sent the string
`"true"`, which is accepted too, in any case. Adding a provider therefore means trusting it with
that claim — see
[decisions/authentication.md](decisions/authentication.md#the-email-stays-the-identity-and-every-provider-must-verify-it).

## Apps sign in with a bearer ID token

The mobile app (#264) cannot use the cookie: Google refuses sign-in inside a WebView, and a cookie
set in the system browser never reaches the app. It signs in with its platform's own sign-in —
Google's SDK, or code + PKCE through the system browser — and sends the **ID token** it is given as
`Authorization: Bearer` on every request ([decisions/mobile-app.md](decisions/mobile-app.md)).

```
App      sign-in with the platform's SDK          → an ID token, kept in the Keychain / Keystore
App      GET /api/tasks  Authorization: Bearer <ID token>
Backend  provider by the token's iss → signature, issuer, expiry (go-oidc)
         → issued to one of the provider's clients? an ID token? email verified? (verifyIDToken)
         → 200, or 401 — never a redirect, never a session cookie
```

- **A request with an `Authorization` header is judged by its token alone**, never by a cookie;
  any other is judged by its session cookie (`Service.Identify`). The website sends no such header.
- **The provider comes from the token's issuer.** The unverified `iss` only chooses whose keys
  verify the token; nothing else is read from it before it is verified. Providers sharing an issuer,
  as two clients of one Cognito pool would, are each tried.
- **The token must have been issued to us.** Its `aud` must name the provider's client id or one of
  `TASKFEST_OIDC_<ID>_AUDIENCES`; the client id is always among them, since Android's Credential
  Manager issues tokens for the website's client. Without the check, an ID token that *any* other
  site obtained from Google would sign its holder in here. Google's further audience is the iOS
  client id from the environment's `google_ios_client_id` (#280), which Google's iOS SDK issues
  tokens for; qa's Cognito one is the app's own public client (#267), since an installed app cannot
  keep a secret; locally Keycloak's is `taskfest-app`.
- **Only an ID token is a way in.** A token that is no JWT is refused, since there are no claims to
  check; so is one declaring itself an access token (Keycloak's `typ`, Cognito's `token_use`).
- **Google's issuer must be the `https` one.** Google documents that an ID token's `iss` may also
  be `accounts.google.com` without the scheme; such a token matches no provider's issuer and is
  refused. The native SDKs issue the `https` form, which #280 confirmed with a real token.
- **Metadata and keys are fetched once, not per request.** Each provider's metadata is discovered
  on first use and kept for the life of the Lambda execution environment, and asked again after a
  failure rather than remembered; its signing keys are kept likewise and fetched again only for a
  key id they do not know. Fetching either is bounded to five seconds, and exchanging a code at the
  callback to ten. Where a
  `DISCOVERY_URL` is set, the metadata found there must still name the configured issuer.
- **Both ways in give the same identity** (`identity.Identity`), so every handler serves the
  website and the apps alike. The function checks tokens itself rather than with API Gateway's JWT
  authorizer: the cookie needs the function anyway, and one place decides for both.
- **How long it lasts is the app's business.** The backend only ever sees ID tokens, valid for an
  hour at Google and renewed silently by the SDK. The app signs itself out after 30 days without
  use ([mobile/sign-in.md](mobile/sign-in.md)); the website's limits are unchanged.

## The provider list

`GET /api/auth/providers` drives the signed-out screen (`Config.List`, ordered by id). A provider
is advertised as usable purely because configuration gave it a client id and secret:

```go
Available: c.Enabled && p.Usable() // a client id and a secret, neither blank
```

No provider name appears in the code, on either side. Adding one is a configuration change:
its id joins `TASKFEST_AUTH_PROVIDERS`, its `TASKFEST_OIDC_<ID>_*` settings are set, and a sign-in
button appears with it. The local stacks declare `keycloak`; AWS declares `google`, and `cognito`
in qa alone. **A provider not declared is not part of the deployment at all**: it is left out of
the list and its paths are a 404 — so prod's list holds Google alone.

A declared provider without credentials is **still reported**, with `available: false` and a
null `loginUrl` — but the frontend **hides** it rather than showing it disabled
(`SignedOut.tsx`), and says sign-in is not configured when nothing is left. The endpoint reports
it anyway so that a caller can tell a provider that exists but is unconfigured from one that was
never declared; see
[decisions/frontend.md](decisions/frontend.md#the-board-is-the-front-page-the-project-description-is-a-link).
In AWS a Google client secret that cannot be read stops the function's start instead.

## Local accounts

`keycloak/realm-taskfest.json` is imported by the end-to-end stack's Keycloak, which also backs
running the backend from source ([local-development](local-development/index.md)), so the same
realm backs local runs and CI. It has two clients: `taskfest-backend`, the backend's, and
`taskfest-app`, the mobile app's public one.

| Account | Password | Email |
| --- | --- | --- |
| `gunnar` | `gunnar` | `gunnar@example.com` |
| `lasse` | `lasse` | `lasse@example.com` |

The email claim is not optional decoration — it *is* the identity, so a token without one is
refused. See [domain-model.md](domain-model.md).

These credentials are testing-only placeholders and belong in the repository. Real secrets
never do.

## What the browser learns about you

`GET /api/auth/me` answers with three fields, and only the first is identity:

| Field | Where it comes from | Absent when |
| --- | --- | --- |
| `email` | the `email` claim | never — a token without one is refused |
| `name` | the `name` claim | the provider supplied none |
| `pictureUrl` | the `picture` claim, else a Gravatar the backend has confirmed exists | neither is available |

An absent field is `null`.

**The name and picture are not part of the account.** Nothing stores them with the user's tasks:
the website's session item keeps them, with the email, for as long as the session lasts, and a
bearer request reads them from its token each time. The email remains the whole of the identity,
which is what a user's partition is keyed by and what ownership is decided on. A consequence worth
knowing: because nothing outlives the session, a name can only ever be shown to its own owner.
Anything that had to display one user's name to another — sharing, an audit trail — would have
to revisit that
([decisions/authentication.md](decisions/authentication.md#name-and-picture-are-session-data-not-identity)).

Both need the `profile` scope, which every sign-in asks for. These are non-sensitive scopes;
Google needs no verification review for them, and `picture` arrives with `profile` rather than
being a permission of its own.

### The Gravatar fallback

Consulted **only** when the provider sent no `picture`, and only by `/api/auth/me`, never by the
callback or another request (`Service.WithPicture`, `internal/gravatar`). Google almost always sends
one; Keycloak here never does.

The backend makes the request rather than the browser, so that "if an image is available" is
actually answered — `?d=404` is what makes Gravatar say no instead of inventing a picture.
**This does not make the browser's request go away**: the page still loads the image from
gravatar.com, so a third party still sees the reader's address and a hash of their email. What
the server-side check buys is a truthful answer, not privacy.
[decisions/authentication.md](decisions/authentication.md#gravatar-is-asked-by-the-backend-and-that-buys-accuracy-rather-than-privacy)
records that rather than leaving it implied.

Two things stop it becoming a liability on the sign-in path. The answer, picture or none, is
**remembered** by address for the life of the execution environment, because `/api/auth/me` runs
on every page load and would otherwise mean an outbound request on every page load. And
**failure is not an error**: a slow or unreachable Gravatar, which gets two seconds, yields no
picture and is asked again next time, and sign-in carries on. Nobody should be locked out of their
tasks because an avatar service is having a bad day.

`TASKFEST_GRAVATAR_ENABLED=false` switches it off entirely, which is what the end-to-end stack
does so that it never reaches the internet.

## Settings that are load-bearing

Three settings look innocuous and are not; each of them, wrong, sends sign-in somewhere else.

- **`TASKFEST_PUBLIC_ORIGIN` in AWS.** The redirect URI is built from it; without it, it would be
  built from API Gateway's host, which the provider does not know and the browser cannot use.
- **`changeOrigin: false` in `vite.config.ts`, `ProxyPreserveHost On` in httpd.** Both proxies
  default to rewriting the `Host` header. Where `TASKFEST_PUBLIC_ORIGIN` is unset, as when running
  from source, the backend builds the redirect URI from that header, so a rewritten host returns
  the browser to the backend's port instead of the app.
- **`TASKFEST_OIDC_KEYCLOAK_DISCOVERY_URL` in the end-to-end stack.** Keycloak's issuer is the
  browser's `http://localhost:8082`, which a container cannot reach; the backend fetches the
  metadata from `http://keycloak:8082` and still checks it names the browser's issuer
  ([local-development/end-to-end-stack.md](local-development/end-to-end-stack.md)).

## What is tested

The Go tests run against `fakeProvider` (`internal/auth/provider_test.go`), an OpenID Connect
provider in the test with its own keys, discovery and token endpoint.

- `internal/auth/flow_test.go` — the code flow: PKCE and a nonce, the redirect URI from the public
  origin, a session and back to the app; a callback from another browser refused, a callback used
  once, a wrong nonce, an unverified address and a provider's error refused; signing in while
  signed in; a session ending after eight idle hours and seven days after sign-in, and not written
  on every request; sign-out ending it on the server; the Quarkus cookies cleared; only a usable
  provider's paths answering, and a further provider signing in at its own callback.
- `internal/auth/bearer_test.go` — the apps' way in: a verified email signed in; a token issued to
  another application, an unverified address, an access token, and an expired, forged or unknown
  token refused; an app's own client accepted where named; the provider chosen by issuer, and
  providers sharing one; a request with an `Authorization` header never judged by its cookie.
- `internal/auth/config_test.go`, `discovery_test.go`, `end_test.go` — the settings and the
  mistakes that stop the start, the provider list, discovery at another address, and ending a
  session without a redirect, as deleting an account does.
- `internal/api/auth_test.go` — `/api/auth/me`, the provider list against the contract, and each
  sign-in path reaching its provider; `internal/store/sessions_test.go` — the items, and a sign-in
  under way taken once and not late; `internal/gravatar/gravatar_test.go` — the fallback.
- `e2e/tests/login.spec.ts` — the real authorization code flow against the stack's Keycloak in a
  real browser through httpd, including two accounts not seeing each other's tasks.
- The live tests sign in to qa with its Cognito test accounts ([testing/live.md](testing/live.md)).

See [testing.md](testing/index.md).
