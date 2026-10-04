# Authentication

## Backend-for-frontend authentication

**Decision.** The backend is the OIDC client; tokens live in the encrypted `q_session`
cookie and never reach the browser.

**Why.** Tokens in browser storage are the part of the alternative design that goes wrong,
and a cookie session is less machinery for a single-origin app.

**Cost.** Sign-in must be a full-page navigation, `fetch` calls need
`X-Requested-With` so they get a 401 rather than a redirect, and both proxies must preserve
the `Host` header. See [authentication.md](../authentication.md).


## One OIDC tenant, switched per profile

**Decision.** A single `quarkus.oidc.*` tenant pointed at Google in production and at a
local Keycloak in dev and test, rather than Quarkus OIDC multi-tenancy.

**Why.** The two never need to be live at the same time, and multi-tenancy would add
configuration surface for no gain.


## Provider availability comes from configuration

**Decision.** `/api/auth/providers` marks a provider usable because configuration supplied
a client id and secret — no provider name appears anywhere in the code.

**Why.** It was previously a hard-coded `equals("google")`, which meant the UI advertised
three providers that could never work, and meant adding one was a code change. Now a
provider is a configuration block, and a credential-less provider renders disabled, which
is also exactly what a fresh production deployment should show.

**Cost.** `AuthProviderResourceTest` had to change with it.


## Name and picture are session data, not identity

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

