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
is used, once, for the trade below; the access token and a refresh token the provider adds are
dropped. The local realm still lets the dev client ask for `offline_access`; nothing does (#633).

Google is different: it wants its own SDKs on phones rather than a browser flow — below. So is
Apple, whose sign-in is native too, and on iOS only.

## App sessions

Whichever way the person signs in, the app then trades the ID token at
`POST /api/auth/app-session` (`startAppSession` in `mobile/src/api.ts`) and keeps the session it
gets instead: its token, its end, and the address of the ID token it was traded for, since the
token itself says nothing about the account (`mobile/src/staySignedIn.ts`). The backend trades an
ID token once only, and the first trade is the one that counts.

- **Refused** (401), **unanswered or not possible just now**: the sign-in did not work, and the app
  says so and keeps no session, and Google's SDK is signed out of. Signing in again brings a new
  ID token to trade, so one whose trade went unanswered, and may have been made after all, is never
  sent a second time.
- **Signing out** ends the session at the backend with `DELETE /api/auth/app-session`, as well as
  forgetting it on the phone ([account.md](account.md)). It is not waited for: offline, the phone
  forgets the session all the same, and the backend ends it when its 30 days are over. A session
  the backend has refused already, or that went with the account, is not sent again.

### Sessions from before

A session kept by a release before app sessions (before v1.8.0) is the provider's ID token itself.
v1.8.0 traded it silently; since #633 the app does not read it any more. A phone updated straight
from an older release starts at the sign-in, without a notice, and that start deletes its old tokens
from the keychain
([decision](../decisions/authentication.md#the-app-no-longer-knows-sessions-from-before-app-sessions)).

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

Google's SDK keeps the account it signed in with. A Google session says so (`via: 'google'`), and
signing out of it signs out of the SDK too, so the next sign-in asks which account.

**Only a build that knows the client ids has it.** `mobile-release.yml` takes the variant's web
and iOS client ids from its environment's `terraform.tfvars`
(`.github/scripts/google-client-ids.py`), the ids that environment's backend accepts, and a
release refuses to build without them
(`.github/scripts/check-mobile-release-settings.sh`): a prod app without Google has no way in. A
build without them elsewhere — the dev build, CI's — offers its other sign-in, or says sign-in is
not configured. The library's Expo config plugin is in every build all the same: its pods only build
with what it adds to the Podfile. It also registers the iOS client id reversed as a URL scheme,
which Google's SDK returns to the app by — a placeholder in a build without Google.

### Setting it up, once

In each environment's Google Cloud project, the one of its website's web client — qa's and
prod's are separate (#607) — *APIs & Services → Credentials → Create credentials → OAuth client
ID*:

1. **Android**, for the environment's package, `de.hilling.taskfest` or `de.hilling.taskfest.qa`,
   with the **SHA-1 of the app signing key** from Play Console → the app → *Test and release → App
   integrity → App signing*. Play re-signs every build with that key, so it is the one phones see;
   a bundle signed only with the upload key, installed outside Play, will not sign in. The Android
   client ids appear nowhere: Google recognises the app by package and key.
2. **iOS**, for the environment's bundle id: `de.hilling.taskfest` or `de.hilling.taskfest.qa`.

Credential Manager finds the Android client by the web client's project, so the two must be in the
same one.

Then the environment's `terraform.tfvars`: the web client's id as `google_client_id` and the iOS
client's as `google_ios_client_id`, applied as usual. The backend accepts both as an ID token's
audience (until then, an iOS sign-in is refused with 401), and the next release builds the app with
them. Client ids are not secrets: every app and web page that signs in with Google carries one.
Each environment has a client secret of its own
([deployment/names-and-certificates.md](../deployment/names-and-certificates.md)). qa's clients are
in a project of their own, kept to its test users
([decision](../decisions/authentication.md#qa-signs-in-with-a-google-project-of-its-own)); until
that project exists, qa's `google_client_id` is still prod's.

**A new web client locks out the apps installed before it.** Once the environment's
`google_client_id` names another client, its backend refuses ID tokens for the old one, so an
installed app built with the old id cannot sign in with Google until it is updated to the next
release. That is accepted for qa's move to its own project, whose only testers are told; there is
no transition with both ids accepted, which would need the backend to take two web clients.

## Apple

Sign in with Apple on iOS (#281), with
[expo-apple-authentication](https://docs.expo.dev/versions/v58.0.0/sdk/apple-authentication/):
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
`taskfest.appSession`, in one write.

## How long it lasts

**30 days from the sign-in**, as the backend's app session does
([decisions/authentication.md](../decisions/authentication.md#an-app-trades-its-id-token-once-for-an-app-session)):

- However much or little it is used: the app renews nothing, and the session has no idle limit.
- A session that has ended, or that the backend refuses (401), ends on the phone too, and the app
  says so and offers the sign-in again — as the website does when its cookie has expired.
- Signing out ends it on the phone at once ([account.md](account.md)), and at the backend as far
  as it can be told: the app does not wait for the backend's answer, and only logs a failure, so
  offline the session stays valid at the backend until its 30 days are over, though no phone holds
  its token any more.
