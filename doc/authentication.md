# Authentication

How TaskFest signs people in: the website through the backend, with a session the backend keeps,
and the apps with a bearer ID token, or an app session they trade one for
([App sessions](#app-sessions)). The code is `serverless/internal/auth`, with the sessions'
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
  scopes `openid email profile`, unless a provider's `SCOPES` setting says otherwise.
- **A provider may return the browser by a form POST** instead of the redirect in step 5, where
  its `RESPONSE_MODE` is `form_post`: Apple does so whenever a scope is asked for
  ([Sign in with Apple](#sign-in-with-apple)). The backend then adds `response_mode=form_post` to
  step 3, and that provider's callback answers a POST and reads the code and state from its form,
  never from the query. Every other provider's callback answers a GET alone; the other method is
  a 405.
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
`TASKFEST_COOKIE_SECURE=false` says the site is plain HTTP, which only the end-to-end stack and running from source do. The
table stores only each value's SHA-256, so nothing in it lets anyone in. Signing in or out also
expires any `q_session…` and `q_auth…` cookie a browser still holds from the Quarkus backend.

**One exception: `taskfest_signin` for a `form_post` provider is `SameSite=None`.** A browser
does not send a `Lax` cookie with a POST from another site, so with `Lax` the state check would
refuse every sign-in that provider posts back. `None` is safe for this cookie because it carries
no authority: it holds the random state of one sign-in, for ten minutes, and the callback refuses
any POST whose state is not the cookie's — a forged one cannot know it, and an attacker's own code
and state (login CSRF) do not match the victim's cookie. That comparison is the CSRF defence, and
it needs the cookie. `None` requires `Secure`, so where cookies are not `Secure` it stays `Lax`;
a `form_post` provider needs `https` anyway. The session cookie stays `Lax` for every provider
(`Service.signInCookie`;
[decisions/authentication.md](decisions/authentication.md#a-provider-may-sign-its-client-secret-and-post-the-browser-back)).

## Sign-out

`GET /api/auth/logout` deletes the session's item, and its link from the user's partition, expires
the cookie, and redirects to the post-login redirect (`Service.Logout`). Since the session lives on
the server, a copy of the cookie stops working too.

It is deliberately **not** an
RP-initiated logout, so the identity provider's own session survives: signing out and back
in will not prompt for credentials again. This matters for tests — the Playwright suite
opens a fresh `browser.newContext()` per account, because reusing one would silently sign
the second account in as the first.

Deleting the account ends its sessions on every device, the apps' sessions among them, through the
links each sign-in writes into the user's partition
([serverless.md](deployment/serverless.md#deleting-an-account)). The apps sign out with
`DELETE /api/auth/app-session` ([App sessions](#app-sessions)).

## Which provider, where

Every deployment with sign-in has a **main provider**, which signs in at `/api/auth/login`, and may have
**further providers** beside it (#143) — qa gets a Cognito pool with test accounts that automated
tests can sign in with (#190), since Google forbids automating its own sign-in. The main provider
is the first in `TASKFEST_AUTH_PROVIDERS`.

| Where | Providers | Credentials |
| --- | --- | --- |
| prod | `google` | the client id from `terraform.tfvars`; the secret from Secrets Manager, named by `TASKFEST_OIDC_GOOGLE_CLIENT_SECRET_ARN` and read once per cold start (`internal/secrets`) ([deployment/names-and-certificates.md](deployment/names-and-certificates.md)) |
| qa | `google`, and `cognito` beside it (`test_sign_in = true`) | Google's as in prod; the test accounts' pool and client are made by `deployment/aws-tofu/modules/environment/test-sign-in.tf`; `serverless.tf` puts the client's id and secret in the function's settings |
| the end-to-end stack, and running from source | `keycloak` | `taskfest-backend` / `taskfest-secret`, checked in as throwaway values |

Either AWS environment adds `apple` after `google` once its `apple_sign_in` is `offered` (#281):
the Services ID, key id and team id from `terraform.tfvars`, the key from Secrets Manager
([deployment/names-and-certificates.md](deployment/names-and-certificates.md#sign-in-with-apple-281)).

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
TASKFEST_OIDC_<ID>_SCOPES=openid,email   # what sign-in asks for; openid,email,profile if unset
TASKFEST_OIDC_<ID>_RESPONSE_MODE=form_post  # the provider POSTs the browser back; query if unset
TASKFEST_OIDC_<ID>_PKCE=false            # leaves PKCE out with this provider; on if unset
TASKFEST_OIDC_<ID>_SIGNING_KEY_SECRET=…  # instead of CLIENT_SECRET: a PEM EC P-256 key that signs
                                         # it, or _SIGNING_KEY_SECRET_ARN, a Secrets Manager secret
TASKFEST_OIDC_<ID>_SIGNING_KEY_ID=…      # the key's id, the signed secret's kid
TASKFEST_OIDC_<ID>_SIGNING_TEAM_ID=…     # the signed secret's iss
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

### Sign in with Apple

Apple (#281) is a further provider like any other, configured, not coded; what sets it apart is
three settings no other provider needs. Its website client is a **Services ID**, whose return URL
is `<public origin>/api/auth/callback/<id>`:

```sh
TASKFEST_OIDC_APPLE_ISSUER=https://appleid.apple.com
TASKFEST_OIDC_APPLE_CLIENT_ID=<the Services ID>
TASKFEST_OIDC_APPLE_SIGNING_KEY_SECRET_ARN=<the secret holding the .p8 file's text>
TASKFEST_OIDC_APPLE_SIGNING_KEY_ID=<the key's 10-character id>
TASKFEST_OIDC_APPLE_SIGNING_TEAM_ID=<the 10-character team id>
TASKFEST_OIDC_APPLE_SCOPES=openid,email
TASKFEST_OIDC_APPLE_RESPONSE_MODE=form_post
```

- **The client secret is a JWT the backend signs** with the team's Sign in with Apple key (the
  `.p8`), as
  [Apple requires](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret):
  ES256, `kid` the key's id, `iss` the team id, `sub` the Services ID, `aud` the provider's
  issuer, `https://appleid.apple.com`. Apple allows six months; the backend signs a fresh one for
  every exchange of a code, valid five minutes, so there is nothing to rotate and nothing worth
  stealing (`signedClientSecret` in `internal/auth/clientsecret.go`). The key is checked at the
  start: one that is no EC P-256 key in PEM, or half the three settings, stops it.
- **PKCE is sent to Apple as to every provider**, though Apple documents none; a forum report says
  its token endpoint ignores the verifier. Should a real sign-in show otherwise,
  `TASKFEST_OIDC_APPLE_PKCE=false` turns it off for Apple alone, without a release; the nonce
  still ties the code to the browser's sign-in. Scopes without `openid` stop the start.
- **The credentials go in the form.** Apple's metadata offers `client_secret_post` alone; a
  provider whose metadata says so gets them in the token request's body, and every other provider
  as before (`authStyle`).
- **Apple POSTs the browser back** whenever a scope is asked for
  ([its authorization request](https://developer.apple.com/documentation/signinwithapplerestapi/request-an-authorization-to-the-sign-in-with-apple-server.)),
  hence `form_post` and the sign-in cookie's `SameSite=None` ([The cookies](#the-cookies)). A
  cancelled sign-in posts `error=user_cancelled_authorize` and goes back to the app.
- **The scopes are `openid email`.** Apple knows no `profile`, and its ID token carries no name
  or picture. The name comes once, at a person's first sign-in, as a `user` field beside the
  code, from the browser and unsigned; the backend does not read it, so an Apple session shows no
  name, and a Gravatar where one exists.
- **The app's native sign-in issues ID tokens to the app's bundle id**, not to the Services ID, so
  `TASKFEST_OIDC_APPLE_AUDIENCES` names the environment's iOS bundle id: `de.hilling.taskfest` in
  prod, `de.hilling.taskfest.qa` in qa (`local.ios_bundle_id` in OpenTofu's `sign-in.tf`). The app
  trades that token for an app session ([App sessions](#app-sessions)).
- **The ID token** carries `email`, `email_verified` as a boolean or the string `"true"`, which
  `verifyIDToken` already accepts, and `is_private_email`, which is not read: a hidden
  `…@privaterelay.appleid.com` address is an account of its own (Q6 on #264, Gunnar's decision).
- **PKCE is sent though Apple documents none**; the nonce, which Apple does document and the
  backend checks, binds the code to the browser either way.

### Every provider must vouch for the email

The email is the identity: with more than one provider, the same address from either means the
same person. So **a sign-in is refused unless the provider says the address is verified**
(`email_verified` in the ID token) — otherwise a provider that hands out unchecked addresses could
sign someone in as another person's account. `verifyIDToken` in `internal/auth/tokens.go` enforces
it for every provider, at the callback and for bearer tokens alike, and refuses a token without an
email. The claim is the boolean `true` at Google and Keycloak; Cognito has sent the string
`"true"`, and Apple documents either, which is accepted too, in any case. Adding a provider
therefore means trusting it with that claim — see
[decisions/authentication.md](decisions/authentication.md#the-email-stays-the-identity-and-every-provider-must-verify-it).

## Apps sign in with a bearer ID token

The mobile app (#264) cannot use the cookie: Google refuses sign-in inside a WebView, and a cookie
set in the system browser never reaches the app. It signs in with its platform's own sign-in —
Google's SDK, Apple's on iOS, or code + PKCE through the system browser — and sends the **ID
token** it is given as `Authorization: Bearer`
([decisions/mobile-app.md](decisions/mobile-app.md)). Since #281 it sends it once, to trade it for
an app session, whose token it sends on every request from then on ([App sessions](#app-sessions)).
An ID token is still accepted on any request: from a session kept from before app sessions until
it is traded, from a sign-in whose trade could not be made just now, and from any other client
that sends one. This section is how it is checked, wherever it is sent.

```
App      sign-in with the platform's SDK          → an ID token
App      POST /api/auth/app-session  Authorization: Bearer <ID token>
           (until it is traded: GET /api/tasks and the rest with it)
Backend  provider by the token's iss → signature, issuer, expiry (go-oidc)
         → issued to one of the provider's clients? an ID token? email verified? (verifyIDToken)
         → 201 or 200, or 401 — never a redirect, never a session cookie
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
- **How long it lasts was the app's business** while it sent ID tokens, valid for an hour at
  Google and renewed silently by the SDK, and signed itself out after 30 days without use. Since
  #281 the app trades every sign-in's ID token for an app session instead, and a session kept from
  before is traded silently ([mobile/sign-in.md](mobile/sign-in.md#app-sessions)); a bearer ID
  token is still accepted, for that transition and for any client that sends one. The website's
  limits are unchanged.

## App sessions

Apple's native sign-in on iOS (#281) gives the app an ID token that it cannot renew without the
person, unlike Google's SDK. So, after every sign-in, whatever the provider, the app trades its ID
token **once** for an **app session** of the backend's own, and sends that session's token from
then on; the backend keeps no provider's refresh token
([decisions/authentication.md](decisions/authentication.md#an-app-trades-its-id-token-once-for-an-app-session)).

```
App      native sign-in                               → the provider's ID token
App      POST /api/auth/app-session  Authorization: Bearer <ID token>
Backend  the ID token checked as any bearer ID token (above) → the session stored
         → 201 { "token": "taskfest_app_…", "expiresAt": "2026-12-16T09:30:00Z" }
App      keeps the token in the Keychain / Keystore
App      GET /api/tasks  Authorization: Bearer taskfest_app_…  → 200, or 401 once it has ended
App      DELETE /api/auth/app-session  Authorization: Bearer taskfest_app_…  → 204 (sign-out)
```

- **An ID token trades once.** The backend remembers each traded token by the hash of its signed
  claims (`TRADED#<hash>`, a conditional write, so two trades at once cannot both pass), not of its
  spelling, which can vary: go-jose ignores whitespace in a token, and base64url's last character
  carries bits nobody reads. It does so for as long as the token is valid, and a day at least,
  longer than Google's and Apple's ID tokens last: one that leaked cannot be turned into many
  thirty-day sessions. A new sign-in brings a new ID token. The session ends on a whole second, as
  it is stored.
- **Only a provider's ID token starts one.** It is verified exactly as a bearer request's is:
  issuer, signature, expiry, audience, an ID token, a verified email. An app session token cannot
  start another, so a session cannot renew itself, and a session cookie cannot start one either.
  Anything else is a 401 (`Service.StartAppSession`).
- **The token is `taskfest_app_` and 32 random bytes in base64url**, 43 characters. It has no dot,
  where a JWT, which every ID token is, has three parts separated by dots; and a JWT begins with
  its header's base64url, `ey` for the `{` its JSON starts with, never with that prefix. The
  prefix alone decides how a bearer token is judged (`IsAppSessionToken`): one with it is looked up
  as an app session and never parsed as a JWT, one without it is checked as an ID token and never
  looked up. An unknown, ended or expired app session token is a 401, as a bad ID token is.
- **It is kept like the website's sessions** (`internal/store/sessions.go`): the item
  `SESSION#<SHA-256 of the token>` holds who signed in, as a website session's does, and is marked
  `app`; a link from the user's partition, the one the account is keyed by
  (`Accounts.AccountEmail`), names it. The table stores only the token's SHA-256.
- **It lasts 30 days from its start** (`AppLifetime`), however much or little it is used: no idle
  limit, and nothing is written per request. Its item and its link carry `expiresAt` 30 days on,
  and the backend checks the time on every read as well. The website's eight hours and seven days
  are unchanged. After the 30 days the app signs in again.
- **Neither kind of session stands in for the other.** An app session token sent as the
  `taskfest_session` cookie signs nobody in, nor does a website session's value sent as a bearer
  token.
- **Sign-out** is `DELETE /api/auth/app-session` with the token as the bearer token: it deletes the
  item and its link, and answers 204, also for a session that had ended already; without an app
  session token it is a 401. Like the website's, it leaves the provider's own session alone.
- **Deleting the account ends it**, as it ends the website's: the account's deletion deletes every
  session its links name, and `DELETE /api/account` sent with an app session token ends that one
  directly too (`Service.EndSession`). Its next request is a 401.
- **Deleting an account signed in with Apple revokes TaskFest at Apple** (#635), as Apple
  asks of an app that offers its sign-in. The app's session is Apple's, so `DELETE /api/account`
  without a body answers 428 and deletes nothing; the app then runs Apple's sheet once more and
  sends the authorization code it issues as `appleAuthorizationCode`. The backend exchanges it at
  Apple's token endpoint as the app's bundle id (the first of `TASKFEST_OIDC_APPLE_AUDIENCES`
  besides the Services ID), with a client secret signed for that id, checks that the ID token it
  brings names the session's Apple ID (`sub`), and revokes the refresh token at Apple's
  `revocation_endpoint`. It does so once the account is marked deleted, when the deletion counts as
  done, so a deletion that fails before then leaves Apple as it was; and within eight seconds in
  all, so the app, which waits 25 seconds for this one request, hears the answer. Nothing of
  Apple's is kept. A failed exchange or revocation, or another Apple ID's confirmation, is logged as
  an error, revokes nothing, and the account is deleted regardless: the person asked for it to go
  (`Service.RevocationForDeletion`, `internal/auth/revoke.go`). The code is no proof of who asks —
  the session is — only what revoking needs. A session of any other provider is asked for
  nothing. The provider is Apple by its issuer, `https://appleid.apple.com`.
- **On the website, Apple confirms at its sign-in, and the callback deletes.** Apple's code for
  the website comes back to the callback, not to the page, so a website session signed in with
  Apple gets the 428 with `appleSignInUrl`: Apple's sign-in, started like any other
  (`Service.ConfirmDeletionAtApple`), whose pending sign-in also names the account to delete and
  the session's Apple ID. The page sends the browser there. The callback exchanges the code as
  every sign-in's is, and where the ID token names the same Apple ID it deletes the account
  through the same steps as the route (`Server.DeleteAccount`), revoking the refresh token that
  exchange brought, as the Services ID, once the deletion counts as done. It then clears the
  session cookie and goes back to the app, which says the account was deleted. Another Apple ID,
  Apple turned away, or a deletion that fails before it counts as done deletes nothing and goes
  back to the app still signed in (`finishDeletion`), which says the deletion failed. A website
  request is sent to Apple's sign-in even with an `appleAuthorizationCode`, which only the app's
  is exchanged as. The DELETE starts it, not a link to the
  sign-in, because another site can send a browser to a link but cannot send that request with
  the browser's session
  ([decisions/authentication.md](decisions/authentication.md#deleting-an-apple-account-revokes-taskfest-at-apple-with-apples-confirmation)).

## The provider list

`GET /api/auth/providers` drives the signed-out screen (`Config.List`, ordered by id). A provider
is advertised as usable purely because configuration gave it a client id and secret:

```go
Available: c.Enabled && p.Usable() // a client id and a secret, neither blank
```

No provider name appears in the code, on either side. Adding one is a configuration change:
its id joins `TASKFEST_AUTH_PROVIDERS`, its `TASKFEST_OIDC_<ID>_*` settings are set, and a sign-in
button appears with it. The end-to-end stack and running from source declare `keycloak`; AWS declares `google`, and `cognito`
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
which is what a user's partition is keyed by and what ownership is decided on: `USER#<SHA-256 of
the email lower-cased>`, so `Gunnar@Example.com` and `gunnar@example.com` are one account whichever
case a provider sends (#622). An account begun before that under an email with capitals was keyed by
the email as sent, and keeps that partition: `Accounts.AccountEmail` (`internal/store/emails.go`)
answers which email keys the account, with one read of that partition's `META` item for an email
with capitals and none for one in lower case. Such a board is found only under exactly that
casing: signed in as `gunnar@example.com`, or as any other casing, the lower-cased account is
used, and the two stay apart until the older one is deleted. The API's caller is that email (`api.Keyed`), and so
are a session's link, an account's deletion and its deletion record. A consequence worth
knowing: because nothing outlives the session, a name can only ever be shown to its own owner.
Anything that had to display one user's name to another — sharing, an audit trail — would have
to revisit that
([decisions/authentication.md](decisions/authentication.md#name-and-picture-are-session-data-not-identity)).

Both need the `profile` scope, which every sign-in asks for but Apple's, which knows none and
sends neither ([Sign in with Apple](#sign-in-with-apple)). These are non-sensitive scopes;
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
- **`changeOrigin: false` in `vite.config.ts`.** Vite's proxy defaults to rewriting the `Host`
  header. Running from source leaves `TASKFEST_PUBLIC_ORIGIN` unset, so the backend builds the
  redirect URI from that header, and a rewritten host would return the browser to the backend's
  port instead of the app. The end-to-end stack sets `TASKFEST_PUBLIC_ORIGIN`, so httpd's
  `ProxyPreserveHost On` is no longer what holds it.
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
- `internal/auth/formpost_test.go` — a provider shaped like Apple's (`postingProvider`): asked for
  `form_post` and its own scopes, a sign-in cookie of `SameSite=None` for it alone and `Lax`
  without `Secure`, a sign-in by POST with a signed client secret sent in the form and checked
  against Apple's documented form, a fresh secret per exchange, a cancelled or another browser's
  POST refused, the form read and not the query, and each callback answering its own method alone.
- `internal/auth/config_signing_test.go` — the scopes, response mode and signing key settings,
  and a half-configured, unreadable or wrong-curve key stopping the start.
- `internal/auth/bearer_test.go` — the apps' way in: a verified email signed in; a token issued to
  another application, an unverified address, an access token, and an expired, forged or unknown
  token refused; an app's own client accepted where named; the provider chosen by issuer, and
  providers sharing one; a request with an `Authorization` header never judged by its cookie.
- `internal/auth/appsession_test.go` — app sessions: an ID token traded for a session that signs
  in as its person, stored by hash alone; the token's format, which never reads as a JWT; 30 days
  with no idle limit and no write per request; only a provider's ID token starting one; neither
  kind of session standing in for the other; signing out, and ending the request's session as
  deleting the account does. `internal/api/appsession_test.go` — the two routes against the
  contract; `internal/store/appsessions_test.go` — the item, its 30-day link, and an account's
  deletion ending it.
- `internal/auth/config_test.go`, `discovery_test.go`, `end_test.go` — the settings and the
  mistakes that stop the start, the provider list, discovery at another address, and ending a
  session without a redirect, as deleting an account does.
- `internal/api/auth_test.go` — `/api/auth/me`, the provider list against the contract, and each
  sign-in path reaching its provider, a callback by GET or POST;
  `internal/store/sessions_test.go` — the items, and a sign-in under way taken once and not late; `internal/gravatar/gravatar_test.go` — the fallback.
- `e2e/tests/login.spec.ts` — the real authorization code flow against the stack's Keycloak in a
  real browser through httpd, including two accounts not seeing each other's tasks.
- The live tests sign in to qa with its Cognito test accounts ([testing/live.md](testing/live.md)).

See [testing.md](testing/index.md).
