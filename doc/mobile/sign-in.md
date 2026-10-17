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

Google is different: it wants its own SDKs on phones rather than a browser flow — below.

## Google

prod signs in with Google only; qa offers Google and its test accounts, which the end-to-end runs
sign in with (#280). `mobile/src/google.ts` uses
[react-native-nitro-google-signin](https://github.com/react-native-nitro-google-sign-in/google-signin):
**Credential Manager** on Android and **Google's Sign-In SDK** on iOS, as S1 on #264 decided. The
older `@react-native-google-signin/google-signin` uses Google's deprecated Android SDK unless paid
for. The ID tokens are asked for on behalf of the **web client** the website signs in with, so
their audience is what the backend already accepts; `TASKFEST_OIDC_GOOGLE_IOS_CLIENT_ID` on the
backend is not needed for them.

**Renewing.** Google gives the app no refresh token; its SDK keeps what it needs. A Google session
says so (`via: 'google'`) and is renewed through the SDK instead: on Android by signing in again
silently — Credential Manager picks the account already chosen, without asking, since the ID token
the library keeps is never renewed — and on iOS by restoring the sign-in and asking for fresh
tokens. Google refusing ends the session as a refused refresh token does; anything else, such as
no connection, keeps it. Signing out signs out of the SDK too, so the next sign-in asks which
account.

**Only a build that knows the client ids has it.** They are repository variables, read by
`mobile-release.yml`; without them qa offers its test accounts only and prod says sign-in is not
configured, and the Expo config plugin is left out, since it refuses to run without the iOS client.
On iOS, the plugin registers the iOS client id reversed as a URL scheme, which Google's SDK
returns to the app by.

### Setting it up, once

In the Google Cloud project of the website's web client, *APIs & Services → Credentials → Create
credentials → OAuth client ID*:

1. **Android**, once per package: `de.hilling.taskfest` and `de.hilling.taskfest.qa`, each with
   the **SHA-1 of the app signing key** from Play Console → the app → *Test and release → App
   integrity → App signing*. Play re-signs every build with that key, so it is the one phones see;
   a bundle signed only with the upload key, installed outside Play, will not sign in. The Android
   client ids appear nowhere: Google recognises the app by package and key.
2. **iOS**, once per bundle id: `de.hilling.taskfest` and `de.hilling.taskfest.qa`.

Then the repository variables (*Settings → Secrets and variables → Actions → Variables*):

| Name | Value |
| --- | --- |
| `TASKFEST_GOOGLE_WEB_CLIENT_ID` | the web client's id, the one in `TASKFEST_OIDC_GOOGLE_CLIENT_ID` |
| `TASKFEST_QA_GOOGLE_IOS_CLIENT_ID` | the iOS client of `de.hilling.taskfest.qa` |
| `TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID` | the iOS client of `de.hilling.taskfest` |

Client ids are not secrets: every app and web page that signs in with Google carries one.

## Where the session lives

In the platform's keychain (`expo-secure-store`), never in plain storage — each part under its own
key, because some iOS releases refused values above about 2 KB (`mobile/src/staySignedIn.ts`).

## How long it lasts

The backend sees only ID tokens, which live an hour, so the month a sign-in lasts is the app's rule
([decisions/mobile-app.md](../decisions/mobile-app.md)):

- An ID token about to run out is renewed with the refresh token, a minute early — or, for
  Google, through its SDK (above).
- A session unused for **thirty days** ends; every use starts the thirty days again.
- A session that cannot be renewed, or that the backend refuses (401), ends, and the app says so
  and offers the sign-in again — as the website does when its cookie has expired.
- Signing out ends it at once, on the phone only ([account.md](account.md)).

The provider has to let the refresh token live that long. Keycloak's does with the
`offline_access` scope, which the `dev` variant asks for — and which a user may only be given
with the realm's default roles: the local accounts are imported with `default-roles-taskfest`,
since an imported user gets no roles otherwise; Cognito's client sets the refresh token's
lifetime itself, and asking for `offline_access` there is an error.
