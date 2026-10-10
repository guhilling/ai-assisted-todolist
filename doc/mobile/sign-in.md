# Sign-in

The app cannot use the website's session cookie, so it signs in as a native app should — the
system browser, a public client, PKCE, the tokens kept on the device (RFC 8252) — and sends the
**ID token** to the backend as `Authorization: Bearer`. The backend's side is in
[authentication.md](../authentication.md#apps-sign-in-with-a-bearer-id-token).

## How

`mobile/src/provider.ts` runs the code flow with `expo-auth-session`, against the variant's
provider and the app's own public client there: `taskfest-app` at the local Keycloak, and qa's
Cognito app client once it exists. The redirect is `<bundle id>://oauthredirect`. Only the ID token
and the refresh token are kept; the access token is never used.

Google is different: it wants its own SDKs on phones rather than a browser flow, and comes with
#280.

## Where the session lives

In the platform's keychain (`expo-secure-store`), never in plain storage — each part under its own
key, because some iOS releases refused values above about 2 KB (`mobile/src/staySignedIn.ts`).

## How long it lasts

The backend sees only ID tokens, which live an hour, so the month a sign-in lasts is the app's rule
([decisions/mobile-app.md](../decisions/mobile-app.md)):

- An ID token about to run out is renewed with the refresh token, a minute early.
- A session unused for **thirty days** ends; every use starts the thirty days again.
- A session that cannot be renewed, or that the backend refuses (401), ends, and the app says so
  and offers the sign-in again — as the website does when its cookie has expired.

The provider has to let the refresh token live that long. Keycloak's does with the
`offline_access` scope, which the `dev` variant asks for — and which a user may only be given
with the realm's default roles: the local accounts are imported with `default-roles-taskfest`,
since an imported user gets no roles otherwise; Cognito's client sets the refresh token's
lifetime itself, and asking for `offline_access` there is an error.
