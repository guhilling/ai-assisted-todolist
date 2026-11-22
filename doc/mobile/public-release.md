# Public store release

What it takes to move the app from testers only ([distribution.md](distribution.md)) to the
stores' public listings (#608): Android first, on Play's production track; iOS once Sign in with
Apple (#281) is done. App Store Review Guideline 4.8 asks an app with Google's sign-in to offer a
login service with privacy features beside it, limited data and a private email address among
them, and Sign in with Apple is that service.

Only the prod app goes public, `de.hilling.taskfest`; the qa app stays with testers. Going public
revises the decision
[Testers only, one app per environment](../decisions/mobile-app.md#testers-only-one-app-per-environment),
which the change that makes it public marks superseded, and `distribution.md` with it.

Going public in each store is Gunnar's decision, and so are the listing's texts and screenshots
and the answers about data, which are statements of Hilling IT GmbH. This page lists what each
store asks for. The answers below were proposed by Claude, from the privacy policy and the code.
Gunnar confirmed them on 2026-11-22.

## What has to come first

- **A public backend.** The app signs in against prod, which is open to testers only until the
  website is open to everyone (#607).
- **Play's developer verification** of the organization account, should Play Console ask for it:
  an organization registers with a D-U-N-S number and a website verified in Search Console
  ([Android developer verification](https://support.google.com/android-developer-console/answer/16561738)).
- **The target API level** is already met: Play takes new apps and updates only when they target
  Android 16 (API 36) since 31 August 2026
  ([target API level](https://support.google.com/googleplay/android-developer/answer/11926878)),
  and the release build targets 36, as the Expo SDK sets it.
- **No closed test.** Play's 12 testers for 14 days apply to personal accounts created after
  13 November 2023
  ([testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465));
  Hilling IT GmbH's is an organization's. Play Console shows whether *Production* is unlocked.

## Play: App content

Play Console → *Policy and programs → App content*. Every declaration must be done before a
production release
([prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455)).

| Declaration | What Play asks | Answer |
| --- | --- | --- |
| Privacy policy | A public web page, in the listing and in the app | The documentation site's privacy policy, which the app's Account sheet links already ([account.md](account.md)) |
| Ads | Whether the app shows ads | No |
| Advertising ID | Whether the app uses it; asked of every app targeting API 33 or later | No |
| App access | How a reviewer gets past the sign-in | A Google account of the company's own, for review only, its address and password entered in Play Console only, never in the repository (see below) |
| Target audience | The age groups the app is for | 18 and over: a task list for adults, which keeps it out of the Families policy |
| Content rating | The rating questionnaire | No violence, no gambling, nothing shared between users, no location shared: the lowest rating in every region |
| Data safety | See below | See below |
| Account deletion | An in-app way, and a web link | The app's *Delete account* ([account.md](account.md)); the web link is the privacy policy's *Your rights*, which says how, and the website's own *Delete account* |
| News, government, financial features, health | Whether the app is one | No, to each |
| Sensitive permissions | A form for SMS, call log and the like | None needed: the app asks for notifications and the camera, and Android's photo picker needs no permission |

Play's reviewers sign in with details the developer gives them: for a sign-in with Google, "provide
all account information with detailed instructions", details that are "reusable, and valid
regardless of user location", that bypass a 2-step verification code, and are in English
([sign-in details for review](https://support.google.com/googleplay/android-developer/answer/15748846)).
So the review account has no 2-step verification, and its password does not expire. Until the
website is open to everyone (#607), the account must also be one of the Google console's test
users, or its sign-in is refused at the consent screen.

Google may still challenge a sign-in from a device or place it does not know, and the help pages
we read name no way to turn that off. Should a review fail because of it, the sign-in details can
be changed in Play Console and the app sent for review again
([prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455)).

Gunnar's steps, before the app is submitted for production:

1. Create the account in the company's name, without 2-step verification.
2. Before #607, add it to the test users in the Google console.
3. Sign in to TaskFest on prod with it once, and add a few sample tasks for the reviewer to see.
4. Sign in with it on another device too, to see whether Google challenges it.
5. Enter its address and password, with instructions in English, in Play Console under *App content
   → App access* (*Sign-in details* in Google's newer help), and nowhere else.
6. Keep it working after the release: a changed password goes into Play Console too.

The account deletion policy asks for both ways because the app lets a person create an account:
"provide users with an in-app path to delete their app accounts and associated data", and "a web
link resource where users can request app account deletion and associated data deletion"
([account deletion](https://support.google.com/googleplay/android-developer/answer/13327111)).
The web link must name the app or the company as the listing does, and work without the app.

## Play: Data safety

What the app and its backend collect, as the privacy policy ([privacy.md](../privacy.md)) says
it ([data safety](https://support.google.com/googleplay/android-developer/answer/10787469)).
"Collected" is anything that leaves the phone, the backend included; data processed for the
company by its processors (AWS, Hetzner) is not "shared".

**For the whole app:** all data is encrypted in transit (HTTPS only); users can ask for
their data to be deleted (*Delete account*, in the app and on the website).

| Data type | Collected / shared | Required | Purposes | Because |
| --- | --- | --- | --- | --- |
| Personal info → Email address | Collected | Required | App functionality, account management | Every account is keyed by it |
| Personal info → Name | Collected | Required | Account management | Google sends it at sign-in, and it is kept with the session; the app does not show it |
| Personal info → User IDs | Collected | Required | Account management | The account's identifier at Google or Apple, kept with the session |
| Personal info → Other info | Collected | Required | Account management | The address of the profile picture Google sends, kept with the session; the app does not show it |
| Photos and videos → Photos | Collected | Optional | App functionality | Images attached to tasks |
| Files and docs | Collected | Optional | App functionality | PDFs attached to tasks, and every file's name |
| Other user-generated content | Collected | Required | App functionality | The tasks themselves |
| App info and performance → Diagnostics | Collected | Required | App functionality, analytics, fraud prevention and security | The technical log of each request, kept 90 days, and 30 at Hetzner: for running the app securely and finding the cause of errors, which Play counts as analytics |

Not declared: **approximate location**, because the IP address in the technical log
is never turned into a place, which is what Play's location type asks about; and **app
interactions**, because the app records nothing of what a person does in it beyond the requests
in the technical log: no analytics tool, nor tracking of any kind. **Nothing is shared**: the
Gravatar lookup by a hash of the address (privacy policy, *Profile pictures*) is made for the
website's `GET /api/auth/me`, which the app never calls. Reminders are scheduled on the phone and
never leave it.

## Play: Store listing

Play Console → *Grow users → Store presence → Main store listing*
([preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)):

| Asset | What Play takes | Where it comes from |
| --- | --- | --- |
| App name | 30 characters | "TaskFest" |
| Short description | 80 characters | Gunnar's |
| Full description | 4,000 characters | Gunnar's; the README's first paragraph is a start |
| App icon | 512 × 512 PNG with alpha, up to 1 MB | `mobile/assets/store/play-icon.png`, which `render-icons.sh` renders from the app's own |
| Feature graphic | 1024 × 500, JPEG or PNG without alpha; required | `mobile/assets/store/feature-graphic.png`, rendered the same way: the mark and the name beside a task list, with no other text, so it serves both languages |
| Phone screenshots | 2 to 8, JPEG or 24-bit PNG without alpha, 9:16 or 16:9, each side 320 to 3,840 px | From the app on a phone: the board, a task with its files, the reminders |
| Contact email | Required, and shown on the listing | The privacy policy's contact address, which is public already |

Both languages the app speaks, English and German, can have a listing of their own.

Both listings link the terms of use ([terms.md](../terms.md)) beside the privacy policy, in the
full description: Play has no field of its own for them.

## Permissions on the listing

`SYSTEM_ALERT_WINDOW` comes with Expo's template, and the listing would show it as drawing over
other apps: `android.blockedPermissions` in `mobile/app.config.ts` takes it out of the release
builds. `VIBRATE`, the template's too, stays: it is a normal permission, which nobody is asked for;
whether the reminders need it has not been checked. The storage permissions are for Android 12 and
older only (`maxSdkVersion` 32).

## iOS, after Sign in with Apple

App Store Connect asks for the same in its own form: the privacy nutrition labels (the data types
above, in Apple's categories), a demo account for App Review, the privacy policy's address, and
screenshots for the iPhone sizes it requires and for the 13-inch iPad, since the app supports
tablets (`supportsTablet` in `mobile/app.config.ts`). This section is filled in once #281 is done.
