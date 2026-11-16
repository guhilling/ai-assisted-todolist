# Authentication

## Backend-for-frontend authentication

*Accepted · 2026-09-25 · #14*

Revised in part for the Go backend (#549, Gunnar's decisions): the session is an item in DynamoDB,
not an encrypted cookie, so the cookie holds only a random id and sign-out ends the session on the
server; and it is never renewed with the provider, ending after eight hours without a request and
in any case seven days after sign-in
([serverless.md](../deployment/serverless.md#sign-in)).

Revised in part on 2026-11-16 (#613): the Go backend answers a plain 401 whatever a request
carries, so `X-Requested-With` is no longer needed, and only Vite's proxy, where
`TASKFEST_PUBLIC_ORIGIN` is unset, must preserve the `Host` header.

**Decision.** The backend is the OIDC client; tokens live in the encrypted `q_session`
cookie and never reach the browser.

**Why.** Tokens in browser storage are the part of the alternative design that goes wrong,
and a cookie session is less machinery for a single-origin app.

**Cost.** Sign-in must be a full-page navigation, `fetch` calls need
`X-Requested-With` so they get a 401 rather than a redirect, and both proxies must preserve
the `Host` header. See [authentication.md](../authentication.md).


## One OIDC tenant, switched per profile

*Superseded · 2026-09-25 · #14 · by [A main provider per profile, and named tenants beside it](#a-main-provider-per-profile-and-named-tenants-beside-it)*

One OIDC tenant, its provider chosen per profile: Google in production, Keycloak in dev and test.
Google and Keycloak never needed to be live at once. Live tests against qa needed a second
provider beside Google, and #143 made the others named tenants.

## A main provider per profile, and named tenants beside it

*Accepted · 2026-10-07 · #143, #194*

Revised in part on 2026-11-16 (#559, #613): the Go backend has no tenants and nothing inherited.
Each provider is its own `TASKFEST_OIDC_<ID>_*` settings, the main one first in
`TASKFEST_AUTH_PROVIDERS`, and the cookies' `Secure` is one setting for all of them
([authentication.md](../authentication.md#which-provider-where)). The Quarkus tenant block this
section names is in the tag `pre-serverless`.

**Decision (#143, reversing the earlier "one OIDC tenant").** The default `quarkus.oidc.*` tenant
stays the main provider — Google in production and qa, Keycloak in dev and test — at
`/api/auth/login`. Further providers are named tenants at `/api/auth/login/<id>`, declared purely
in configuration.

**Why it was one tenant.** Google and Keycloak never needed to be live at once, and multi-tenancy
would have added configuration surface for no gain.

**Why it no longer is.** Live tests against qa need accounts a machine can sign in with, and Google
forbids automating its sign-in; qa therefore needs Google *and* a provider with test accounts at
the same time (#141, #190). Gunnar's decision: generic from the start, so a third provider is
configuration again.

**Why the main provider keeps its path.** Symmetric paths for every provider would have changed
five existing tests and every frontend fixture for no behaviour anyone sees (D3 on #141).

**Why the shared settings are repeated per tenant.** Named tenants inherit nothing from the default
one. A resolver that copied the default's configuration at runtime would avoid the repetition, but
only through Quarkus-internal API (`io.quarkus.oidc.runtime.OidcConfig`) and with custom code on
the sign-in path. Instead each shared setting is a `${…}` reference to the main tenant's value, so
it cannot drift, and a test compares them; the block is in [authentication.md](../authentication.md).
The code review of #143 found what a missing one costs: without `cookie-force-secure`, a second
provider's session cookies would have gone out without `Secure` in qa and prod.

**Why every provider has its own callback.** With one shared callback, Quarkus picked the provider
from whichever state or session cookie it read first, so an abandoned sign-in with one provider
could make another's fail. The path decides now, and a completed sign-in clears the other
providers' sessions and state cookies, so a browser is never two people at once.


## The email stays the identity, and every provider must verify it

*Accepted · 2026-10-07 · #143, #194*

Revised in part on 2026-11-16 (#559, #613): the check is `verifyIDToken` in
`serverless/internal/auth/tokens.go`, not `VerifiedEmail`; the rule stands.

Revised in part on 2026-11-16 (#622): the email's case is ignored (Gunnar's decision), so
`Gunnar@Example.com` and `gunnar@example.com` are one user: the partition is the hash of the email
lower-cased. An account begun before under an email with capitals keeps the partition of the
email as sent, found by one read of its `META` item, rather than its data being moved; nothing
existing loses its board. Two such accounts, one per case, stay two until the older is deleted.

**Decision (D1 on #141).** With several providers, the same email from any of them is the same
`User`; no `(issuer, subject)` identity, no migration. A sign-in is refused unless the provider's
ID token says `email_verified` (`VerifiedEmail`).

**Why.** The alternative — identity per provider — needs a migration and a backfill of existing
Google users whose `sub` is known only at their next sign-in, and that backfill would match by
email anyway: the same trust, once more.

**Cost, and it is a real one.** Adding a provider means trusting it to assert *any* email address.
A provider that can be made to vouch for an address it does not control can sign someone in as
that person. That is why the claim is required, why qa's test accounts use `@example.com`
addresses that no Google account can have, and why a new provider is a decision, not just a
configuration change.


## Provider availability comes from configuration

*Accepted · 2026-09-25 · #14*

**Decision.** `/api/auth/providers` marks a provider usable because configuration supplied
a client id and secret — no provider name appears anywhere in the code.

**Why.** It was previously a hard-coded `equals("google")`, which meant the UI advertised
three providers that could never work, and meant adding one was a code change. Now a
provider is a configuration block, and a credential-less provider renders disabled, which
is also exactly what a fresh production deployment should show.

**Cost.** `AuthProviderResourceTest` had to change with it.


## Name and picture are session data, not identity

*Accepted · 2026-09-28 · #63*

Revised in part on 2026-11-16 (#559, #613): the Go backend keeps name and picture on the session
item, so they are stored for the session's life, up to seven days, though never with the tasks
([authentication.md](../authentication.md)). The scopes are the Go backend's own,
`openid email profile`, for the same reason as below.

**Decision.** `/api/auth/me` returns the signed-in person's display name and picture, read
from the provider's token on each request. Neither is stored. `User` remains `id`, `email`,
`createdAt`.

**Why.** The email is what the application means by identity: it is what a `User` is keyed by
and what every ownership predicate compares. A name and a picture are how somebody is shown
their own session — provider-owned attributes that happen to travel with the token. Persisting
them would add a migration, a refresh path and a staleness problem (a Google picture URL
expires) in exchange for nothing the application currently does.

**Cost, and it is the reason to revisit.** Because nothing is persisted, a name can only be
shown to its owner. Anything that had to display one user's name to another — sharing a list,
an audit trail, an admin view — would need this decision reopened and a migration written. That
is a feature change, not an oversight.

**Consequence for scopes.** `quarkus.oidc.authentication.scopes=email,profile` is now set for
every profile rather than only dev and test, because without `profile` Google returns neither
claim. Both are non-sensitive: Google requires no verification review, and `picture` comes with
`profile` rather than being a permission of its own.


## Gravatar is asked by the backend, and that buys accuracy rather than privacy

*Accepted · 2026-09-28 · #63*

**Decision.** When a provider supplies no picture, the backend requests the address's Gravatar
with `?d=404` and returns the URL only when one exists. SHA-256 of the trimmed, lower-cased
address; result cached; two-second timeout; a failure yields no picture rather than an error.

**Why the backend and not the browser.** The requirement was a picture "if an image is
available there", and only a request answers that. Left to the browser, the page would carry a
URL nobody had checked and fall back on a broken image — which works, but means the application
never actually knows.

**What this does not do.** It does not stop the browser contacting gravatar.com: the page still
loads the image from there, so Automattic still sees the reader's IP and a hash of their email,
and an email hash is reversible for any address somebody thinks to try. The server-side check
buys a truthful answer, not privacy. Recorded here because the opposite is easy to assume.

**Why cached, and why failure is silent.** `/api/auth/me` runs on every page load, so an
unguarded lookup would mean an outbound request on every page load. And an avatar is not worth
failing a sign-in over: if Gravatar is slow or down, the answer is "no picture" and the session
proceeds.

**Why SHA-256 rather than MD5.** Gravatar accepts both and documents SHA-256. There is no
reason to derive a public identifier from an email with a broken hash, and the normalisation —
trim, lower-case — matters more than either: get it wrong and the lookup silently returns
somebody else's avatar or nobody's, never an error.

**Rejected: initials only, no third party.** It would have removed the question entirely, and
it is what the fallback does anyway when no image exists. The issue asked for Gravatar, and the
trade is now written down rather than decided by omission.



## Apps send a bearer ID token, and the audience is checked in code

*Accepted · 2026-10-10 · #270*

Revised in part on 2026-11-16 (#559, #613): the checks are the Go backend's own
(`serverless/internal/auth`), not Quarkus' `BearerIdToken` and `token.audience`; the rule stands
([authentication.md](../authentication.md#apps-sign-in-with-a-bearer-id-token)).

Revised in part on 2026-11-16 (#281): an app may trade its ID token once for an app session of
the backend's own, which the rejection below had turned down, and send that session's token
instead; a bearer ID token is still accepted, checked as before ([An app trades its ID token
once for an app session](#an-app-trades-its-id-token-once-for-an-app-session)).

**Decision (#266, S1 on #264).** Every tenant is `hybrid`: the website keeps its code flow and
session cookie, and an installed app sends its ID token as `Authorization: Bearer`. The tenant is
chosen by the token's issuer. `BearerIdToken` refuses a bearer token not issued to the tenant's own
client (unless the tenant lists its audiences in `token.audience`, which Quarkus then checks), and
makes the bearer token the identity's ID token.

**Why the audience in code, not configuration.** Quarkus checks a bearer token's audience only
where `token.audience` is set, so a tenant that forgot it would accept an ID token issued to *any*
application at the same provider — at Google, any site with a Google sign-in could replay its
users' tokens here. A rule every tenant needs, and whose absence fails open, belongs where it
cannot be forgotten; configuring it per tenant would have been one more line in the block for a
new provider, and one more for `NamedTenantSettingsTest` to police.

**Why the bearer token becomes the ID token.** Every resource reads claims through `@IdToken`
(`ClaimsComeFromTheIdTokenTest`), which Quarkus fills only in the code flow. Switching them to the
`SecurityIdentity` would have touched every resource and that test; giving a bearer identity an ID
token credential keeps both unchanged. It is the truth, too: what the app sends *is* an ID token.

**Rejected.** A separate `service` tenant per provider for apps — twice the tenants, and the main
provider's bearer requests would have needed a path or header to reach theirs. And a session of
the backend's own for apps (S2 on #264), which would have needed a session store.


## A provider may sign its client secret, and post the browser back

*Accepted · 2026-11-16 · #281*

**Decision.** Sign in with Apple on the website is a further provider, configured like the
others, and what Apple needs beyond them is three generic provider settings rather than an
`apple` in the code: `SIGNING_KEY_SECRET` (with `_KEY_ID` and `_TEAM_ID`), from which the backend
signs an ES256 JWT as the client secret for every exchange of a code, valid five minutes;
`RESPONSE_MODE=form_post`, for which that provider's callback answers a POST and reads its form;
and `SCOPES`. The sign-in cookie of a `form_post` provider is `SameSite=None` (with `Secure`); the
session cookie stays `Lax` for every provider
([authentication.md](../authentication.md#sign-in-with-apple)).

**Why sign per exchange.** Apple accepts a secret for up to six months, and a long-lived one
would need rotating by hand twice a year or a job to do it. Signing costs microseconds, so a fresh
secret for each code needs no cache, no rotation and no clock for expiry, and one that leaked
from a log is worthless minutes later. The key itself is a secret like Google's client secret,
read from Secrets Manager at a cold start.

**Why the sign-in cookie may cross sites.** Apple POSTs the browser back whenever a scope is
asked for, and a browser does not send a `Lax` cookie with a cross-site POST, so the state check
would refuse every Apple sign-in. `SameSite` keeps a cookie from lending its authority to another
site's request; this one has none to lend. It holds only the random state of one sign-in, for ten
minutes, and the callback refuses a POST whose state is not the cookie's: a forged POST cannot
know the value, and an attacker's own code and state (login CSRF) do not match the victim's
cookie. Comparing state to cookie is the CSRF defence, and it is exactly what needs the cookie.

**Cost.** Two cookie policies instead of one, chosen per provider, and a callback that answers
POST, which was GET alone. The name Apple sends once, unsigned, beside the code is not read, so
an Apple session shows no name. PKCE is sent though Apple does not document it; the nonce binds
the code to the browser either way, and a real sign-in is the first proof Apple ignores it.

**Rejected.** `SameSite=None` for every provider's sign-in cookie — simpler, but it weakens
nothing only as long as the reasoning above holds, so it is limited to where it is needed. A
`response_mode=query` for Apple, which keeps the cookie `Lax` — Apple refuses it once the `email`
scope is asked for, and without that scope its ID token carries no email, which is the identity.

## An app trades its ID token once for an app session

*Accepted · 2026-11-16 · #281*

**Decision (Gunnar, #281).** The mobile app offers Sign in with Apple natively
(`expo-apple-authentication`, iOS). After a native sign-in, the app trades the provider's ID token
once, at `POST /api/auth/app-session`, for a TaskFest **app session** token, and every later
request carries that token as `Authorization: Bearer`. The session is kept in the same store as
the website's sessions, with only the token's SHA-256, and lasts **30 days** from its start, the
apps' sign-in limit; it has no idle limit. `DELETE /api/auth/app-session` ends it, and so does
deleting the account. It works for any provider, and the backend keeps no Apple refresh token
([authentication.md](../authentication.md#app-sessions)).

**Why.** Apple's native sign-in hands the app an ID token that is short-lived and that the app
cannot renew without the person: there is no silent renewal like Google's SDK, so sending it as
the bearer token would soon sign the app out. Renewing through Apple would mean the backend
exchanging the authorization code for Apple's refresh token, keeping it for every person and
checking it with Apple, with Apple's client secret, from time to time: a store of long-lived
credentials, and calls to Apple, where a session of our own needs neither. The session store
exists already for the website, and its links from the account already end every session when
the account is deleted, so an app session costs one more kind of item, not a mechanism.

**Why 30 days, and no idle limit.** The apps sign a person out after 30 days without use today
([mobile/sign-in.md](../mobile/sign-in.md)), and Gunnar took that number as the session's
lifetime. It is counted from the session's start, not renewed by use: renewing it would make the
session last for ever for anyone who uses the app weekly, which the website's seven days do not
allow either. An idle limit inside the 30 days would sign out someone who simply did not open
the app for a while, and would mean a write per request; there is none.

**Why the token cannot be taken for an ID token.** It is `taskfest_app_` and 43 base64url
characters: no dot, where a JWT has three dot-separated parts, and a prefix no JWT starts with.
The prefix alone decides how a bearer token is judged, so an app session token is never parsed as
a JWT, nor an ID token looked up as a session. An app session token cannot start another, nor
does a session cookie; neither kind of session is accepted as the other.

**Cost.** A second kind of bearer token, and a session the backend stores per installation. A
revoked provider account still signs in for up to 30 days, as a website session does for seven.

**Rejected.** Keeping Apple's refresh token to renew its ID tokens: long-lived credentials for
every person, kept and checked with Apple. A session only for Apple: the trade is the same for
every provider, and one way in is less to test.
