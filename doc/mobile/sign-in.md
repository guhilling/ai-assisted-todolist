# Sign-in

The app cannot use the website's session cookie, so it signs in as a native app should — the
platform's own sign-in, or the system browser with a public client and PKCE (RFC 8252) — and
trades the **ID token** it is given, once, for an **app session** of the backend's own (#281). From
then on it sends that session's token as `Authorization: Bearer`, and the token lives in the
keychain. The backend's side is in [authentication.md](../authentication.md#app-sessions), the
decision in
[decisions/authentication.md](../decisions/authentication.md#an-app-trades-its-id-token-once-for-an-app-session).

## How

`mobile/src/provider.ts` runs the code flow with `expo-auth-session`, against the variant's
provider and the app's own public client there: `taskfest-app` at the local Keycloak, and qa's
Cognito app client once it exists. The redirect is `<bundle id>://oauthredirect`. Only the ID token
and the refresh token are kept; the access token is never used.

Google is different: it wants its own SDKs on phones rather than a browser flow — below. So is
Apple, whose sign-in is native too, and on iOS only.

## App sessions

Whichever way the person signs in, the app then trades the ID token at
`POST /api/auth/app-session` (`startAppSession` in `mobile/src/api.ts`) and keeps the session it
gets instead: its token, its end, and the address of the ID token it was traded for, since the
token itself says nothing about the account (`mobile/src/staySignedIn.ts`). The backend trades an
ID token once only, and the first trade is the one that counts.

- **Refused** (401): the sign-in did not work, and the app says so.
- **Not possible just now**, offline or against a backend from before app sessions: a Google or
  OpenID Connect sign-in goes on with its ID token, as before, and is traded later, as a session
  kept from before is (below). An **Apple** sign-in did not work, since Apple's ID token cannot be
  renewed and would end within minutes; the next Apple sign-in brings a new one to trade.
- **Signing out** ends the session at the backend with `DELETE /api/auth/app-session`, as well as
  forgetting it on the phone ([account.md](account.md)). It is not waited for: offline, the phone
  forgets the session all the same, and the backend ends it when its 30 days are over. A session
  the backend has refused already, or that went with the account, is not sent again.

`Caller.idToken` in `mobile/src/api.ts`, and `Session.idToken`, carry whichever token the session
sends: the name goes with the transition (#633).

### Sessions from before

A session kept on the phone by a release before app sessions is the provider's ID token itself.
Gunnar chose to trade it silently: at the first start after the update, the app renews it as it
always did if it is about to run out, trades it, and keeps the app session in its place. Nobody
signs in again. A backend that refuses it ends it, as it would have ended at its next refusal.
One that cannot be asked keeps it, and the app tries again after five minutes, not before every
request (`TRADE_RETRY_MS`). A backend that refuses the trade ends the session, and the app says
it has expired. Until the trade succeeds, the session goes on as before: renewed with the refresh
token or Google's SDK, and ended after thirty days without use.

**An ID token is never sent to be traded twice.** The backend trades one only once, and a trade
whose answer was lost — a timeout, no connection, a server error — may have been made. Such an ID
token is marked as spent, on the phone, and the next trade renews the session first and trades
the new ID token. A session that cannot be renewed is not traded again, and goes on until it
ends. A clear answer that nothing was traded, as a 404 from a backend from before app sessions,
leaves the ID token as it was.

That renewal is only there for the transition, and goes once a release with app sessions has
been in the stores for 30 days (#633).

## Google

prod signs in with Google only; qa offers Google and its test accounts, which the end-to-end runs
sign in with (#280). `mobile/src/google.ts` uses
[react-native-nitro-google-signin](https://github.com/react-native-nitro-google-sign-in/google-signin):
**Credential Manager** on Android and **Google's Sign-In SDK** on iOS, as S1 on #264 decided. The
older `@react-native-google-signin/google-signin` uses Google's deprecated Android SDK unless paid
for. Android's ID tokens are issued for the **web client** the website signs in with, an audience
the backend already accepts. Google's iOS SDK may issue them for the app's own **iOS client**
instead, so the backend accepts that one too: `google_ios_client_id` in the environment's `terraform.tfvars` becomes
`TASKFEST_OIDC_GOOGLE_IOS_CLIENT_ID` in its task ([authentication.md](../authentication.md)).

**The button is Google's own** (#325): the images the website shows, `google-sign-in-light.png` and
`-dark.png` from `frontend/src/assets/` with their `@2x` and `@3x`, following the phone's light or
dark mode. Google's [branding guidelines](https://developers.google.com/identity/branding-guidelines)
would allow a button of the app's own as well, as long as Google's "G" keeps its size and colours,
and would allow its words in the app's language; the app uses Google's image as it is instead, to
look exactly like the website's, so the image is the whole button, in Google's English whatever
the app speaks (`signedOut.google` in the catalogue, the same in both languages). VoiceOver is told it is English; Android has no way to tell TalkBack. Google draws it
40 points high, so it takes 4 more above and below for the finger. qa's test-account button keeps
the app's own style.

**Renewing**, for a session from before app sessions only: an app session is never renewed.
Google gives the app no refresh token; its SDK keeps what it needs. A Google session says so
(`via: 'google'`) and is renewed through the SDK instead: on Android by signing in again
silently — Credential Manager picks the account already chosen, without asking, since the ID token
the library keeps is never renewed — and on iOS by restoring the sign-in and asking for fresh
tokens. Google refusing ends the session as a refused refresh token does — no saved credential on
Android, or an `invalid_grant` passed on from Google on iOS, where the SDK has no code of its own
for it. Anything else keeps the session: no connection, or the user turning away an account sheet
that came up because more than one account has been used with the app. An Android renewal may
take up to two minutes for that sheet, and one that comes back for another account ends the
session rather than switching it. Signing out of a Google session, an app session traded from
Google's ID token included, signs out of the SDK too, so the next sign-in asks which account.

**Only a build that knows the client ids has it.** They are repository variables, read by
`mobile-release.yml`, and a release refuses to build without them
(`.github/scripts/check-mobile-release-settings.sh`): a prod app without Google has no way in. A
build without them elsewhere — the dev build, CI's — offers its other sign-in, or says sign-in is
not configured. The library's Expo config plugin is in every build all the same: its pods only build
with what it adds to the Podfile. It also registers the iOS client id reversed as a URL scheme,
which Google's SDK returns to the app by — a placeholder in a build without Google.

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

And for the backend, each environment's iOS client in its `terraform.tfvars`
(`google_ios_client_id`), applied as usual; until then, an iOS sign-in is refused with 401. prod's
`google_client_id` is the same web client as qa's, as decided
([decisions/mobile-app.md](../decisions/mobile-app.md)), each environment with a client secret of
its own ([deployment/names-and-certificates.md](../deployment/names-and-certificates.md)).

## Apple

Sign in with Apple on iOS (#281), with
[expo-apple-authentication](https://docs.expo.dev/versions/v57.0.0/sdk/apple-authentication/):
Apple's own sheet, no browser, and `mobile/src/apple.ts`. Apple has no SDK for Android, so the
Android app offers Google alone. Only the address is asked for: the backend keys the account by
it, and the app shows no name it would need Apple's for. A person who chooses Hide My Email gives
TaskFest a `…@privaterelay.appleid.com` address, an account of its own: the sign-in says so, in
the website's words.

**The button is Apple's own**, `AppleAuthenticationButton`, drawn by iOS in the phone's language:
white with an outline in light mode, white without one in dark mode, as the website shows Apple's
images, and as large as Google's (`mobile/src/AppleButton.tsx`). It appears only where the phone
says it can sign in with Apple.

**Only a build that is told the App ID has the capability has it.** The entitlement Apple's sign-in
needs fails the signing of an App ID without the capability, so a build keeps it, with
`ios.usesAppleSignIn`, only where the repository variable `TASKFEST_QA_APPLE_SIGN_IN` or
`TASKFEST_PROD_APPLE_SIGN_IN` is `true` (`mobile/src/variants.ts`, `mobile/app.config.ts`).
Expo applies the library's config plugin to every build by itself, and it adds the entitlement
whatever it is told, so the app's own `mobile/plugins/withoutAppleSignIn.ts` takes it out again
everywhere else. The dev build never has it: the local Keycloak takes no Apple token.

### Setting it up, once

1. **At Apple**, in *Certificates, Identifiers & Profiles → Identifiers*: tick *Sign in with
   Apple* for the App IDs `de.hilling.taskfest` and `de.hilling.taskfest.qa`, each *as a primary
   App ID*. The release build's automatic signing makes the profiles anew with it.
2. **The backend** must accept the app's tokens: Apple's sign-in set up for the environment as for
   the website ([names-and-certificates.md](../deployment/names-and-certificates.md)), and offered.
   Then `TASKFEST_OIDC_APPLE_AUDIENCES` names the bundle id, which Apple issues the app's ID tokens
   to ([authentication.md](../authentication.md#sign-in-with-apple)). Until then a trade of Apple's
   token is refused, and the app says the sign-in did not work.
3. **The repository variables** (*Settings → Secrets and variables → Actions → Variables*):
   `TASKFEST_QA_APPLE_SIGN_IN` and `TASKFEST_PROD_APPLE_SIGN_IN`, each `true` once its App ID has
   the capability and its backend takes the tokens. The next release's iOS build offers Apple.

## Where the session lives

In the platform's keychain (`expo-secure-store`), never in plain storage
(`mobile/src/staySignedIn.ts`). An app session is kept whole under a key of its own,
`taskfest.appSession`, in one write, so no half of it is ever read as an ID token; the session it
replaces goes only once it is kept. A session from before keeps each part under its own key,
because some iOS releases refused values above about 2 KB.

## How long it lasts

**30 days from the sign-in**, as the backend's app session does
([decisions/authentication.md](../decisions/authentication.md#an-app-trades-its-id-token-once-for-an-app-session)):

- However much or little it is used: the app renews nothing, and the session has no idle limit.
- A session that has ended, or that the backend refuses (401), ends on the phone too, and the app
  says so and offers the sign-in again — as the website does when its cookie has expired.
- Signing out ends it at once, at the backend and on the phone ([account.md](account.md)).

A session from before app sessions keeps its old rules until it is traded (above). Its provider
has to let the refresh token live that long. Keycloak's does with the `offline_access` scope,
which the `dev` variant asks for — and which a user may only be given with the realm's default
roles: the local accounts are imported with `default-roles-taskfest`, since an imported user gets
no roles otherwise; Cognito's client sets the refresh token's lifetime itself, and asking for
`offline_access` there is an error.
