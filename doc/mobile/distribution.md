# Distribution to testers

Every final release puts the app on testers' phones (#276): the qa and prod builds, signed, go to
**TestFlight's internal testers** on iOS and **Google Play's internal testing** on Android. Testers
only, no public store release ([decisions/mobile-app.md](../decisions/mobile-app.md)).
`.github/workflows/mobile-release.yml` does it; this page says what it does, and what a person sets
up once.

## What a release does

`release.yml` calls `mobile-release.yml` for a final release (`v1.4.0`, not `v1.4.0-rc.1`) once the
GitHub Release exists, so a release that fails on the way never reaches a phone:

| Job | What it does |
| --- | --- |
| `numbers` | Refuses a tag without a GitHub Release; the version from the tag (`1.4.0`), and the build number: minutes since 2026-01-01 UTC |
| `android` (qa, prod) | `expo prebuild`, a bundle signed with the upload key, kept as the run's artifact for 30 days, then uploaded to Play's internal track by `.github/scripts/play-upload.py` |
| `ios` (qa, prod) | `expo prebuild`, an unsigned archive signed ad hoc with the App Group, then `xcodebuild -exportArchive`, which signs with Apple's cloud-managed distribution certificate: once to an `.ipa` that must still carry the App Group, then again to upload to App Store Connect |

- **The build number counts minutes, not runs.** Each store wants it to rise with every upload,
  and the workflow can also be started by hand, which has a run counter of its own. Both platforms
  and both variants of one run share it; each is a separate app in its store.
- **A platform not yet set up is skipped:** `android` until `GOOGLE_PLAY_SERVICE_ACCOUNT` is set,
  `ios` until `APPLE_TEAM_ID` is. Releases go on without them. Once a platform is on, each build
  first checks that every secret and variable it needs is set, and names all that are missing
  (`.github/scripts/check-mobile-release-settings.sh`).
- **To build a release again** — an upload that failed, or Android's first bundle — start *Mobile
  release* from the Actions tab, choose the release's tag under *Use workflow from*, and the
  platform, or both. It refuses a branch, and a tag that has no GitHub Release: only a release
  went through `release.yml`'s checks, which refuse a tag off `main`.
- **The prod app signs in with Google only**, and only once Google's client ids are set
  ([sign-in.md](sign-in.md)); until then it says sign-in is not configured.

## Setting it up, once

Everything below is a person's step: the accounts are Hilling IT GmbH's, and no credential is ever
committed.

### GitHub: the `app-stores` environment

The store credentials are **environment secrets** of `app-stores`, which admits **tags beginning
with `v`** and no branch or pull request: the App Store Connect key is an Admin key. That rule is
coarse; the `numbers` job, which runs before any job enters the environment, accepts only exact
`vX.Y.Z` tags, and only those with a GitHub Release.

1. *Settings → Environments → New environment*: `app-stores`.
2. *Deployment branches and tags → Selected branches and tags → Add rule*: type **Tag**, pattern
   `v*`.
3. Its secrets are added in the steps below. The **repository variables** (*Settings → Secrets and
   variables → Actions → Variables*) are not secret, and a job's `if` can read only those.

| Name | Kind | Value |
| --- | --- | --- |
| `APPLE_TEAM_ID` | repository variable | the team ID |
| `APPLE_API_KEY` | `app-stores` secret | the `.p8` file's whole text |
| `APPLE_API_KEY_ID` | `app-stores` secret | the key's ID |
| `APPLE_API_ISSUER_ID` | `app-stores` secret | the issuer ID |
| `ANDROID_UPLOAD_KEYSTORE` | `app-stores` secret | the keystore, base64 |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | `app-stores` secret | its password |
| `ANDROID_UPLOAD_KEY_ALIAS` | `app-stores` secret | `upload` |
| `ANDROID_UPLOAD_KEY_PASSWORD` | `app-stores` secret | the key's password |
| `GOOGLE_WORKLOAD_IDENTITY_PROVIDER` | repository variable | `projects/<number>/locations/global/workloadIdentityPools/github/providers/github` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | repository variable | the service account's email |
| `TASKFEST_QA_COGNITO_ISSUER` | repository variable | qa's tofu output `test_accounts_issuer` |
| `TASKFEST_QA_APP_CLIENT_ID` | repository variable | qa's tofu output `test_accounts_app_client_id` |
| `TASKFEST_GOOGLE_WEB_CLIENT_ID`, `TASKFEST_QA_GOOGLE_IOS_CLIENT_ID`, `TASKFEST_PROD_GOOGLE_IOS_CLIENT_ID` | repository variables | Google's client ids, from [sign-in.md](sign-in.md) |

`TASKFEST_QA_COGNITO_ISSUER` and `TASKFEST_QA_APP_CLIENT_ID` come from qa once #283 is applied (`tofu output` in `deployment/aws-tofu/environments/qa`).
The qa build refuses to start without them, since it would offer no way to sign in; every build
refuses to start without Google's client ids, for the same reason.

### Apple

An App ID under developer.apple.com's *Identifiers* is not yet an app: the upload also needs an
**app record in App Store Connect** for each bundle ID, or the export stops with "Error
Downloading App Information".

1. **The apps**: App Store Connect → *Apps → + → New App*, iOS, once for `de.hilling.taskfest`
   ("TaskFest AI Demo") and once for `de.hilling.taskfest.qa` ("TaskFest AI Demo QA"). The bundle
   ID is picked from the App IDs; the SKU is any internal name (`taskfest`, `taskfest-qa`). The
   name is unique across the whole App Store, so a taken one needs another.
2. **The team ID**: developer.apple.com → *Account → Membership details*. Repository variable
   `APPLE_TEAM_ID`.
3. **The API key**: App Store Connect → *Users and Access → Integrations → App Store Connect API
   → Team Keys → +*. Name it after its use (*GitHub releases*), access **Admin**: cloud signing
   refuses any lower role. Download the `.p8` — Apple offers it once — and put its text into
   `APPLE_API_KEY`, the *Key ID* into `APPLE_API_KEY_ID` and the *Issuer ID* above the list into
   `APPLE_API_ISSUER_ID`. Keep the file in the password manager, or delete it; a lost key is
   revoked and replaced, nothing more.
4. **Testers**, per app: *TestFlight → Internal Testing → +*, a group with **automatic
   distribution** on, and its members — people in the App Store Connect team (*Users and Access*).
   A build reaches them once Apple has processed it, usually within half an hour.

Export compliance needs no answer per build: the app declares that it uses no non-exempt
encryption (`usesNonExemptEncryption: false` in `app.config.ts`).

#### The share extension and its App Group

Sharing into the app (#356, [sharing.md](sharing.md)) adds a second App ID per app, the share
extension's, and an **App Group** the two share. Apple's API cannot create an App Group or assign
one, so these are steps in the portal, once, before the first release with the extension:

1. **The App Groups**: developer.apple.com → *Certificates, Identifiers & Profiles → Identifiers →
   +* → *App Groups*. Register `group.de.hilling.taskfest` ("TaskFest") and
   `group.de.hilling.taskfest.qa` ("TaskFest QA").
2. **The extensions' App IDs**: *Identifiers → + → App IDs → App*, explicit bundle ID,
   `de.hilling.taskfest.expo-sharing-extension` ("TaskFest share extension") and
   `de.hilling.taskfest.qa.expo-sharing-extension` ("TaskFest QA share extension"). Under
   *Capabilities*, tick **App Groups**, then *Configure* and choose the matching group: the one
   without `.qa` for the prod extension, the `.qa` one for qa's.
3. **The apps' App IDs**: open `de.hilling.taskfest` and `de.hilling.taskfest.qa`, tick **App
   Groups** too, *Configure*, choose the matching group, *Save*. Apple says the profiles become
   invalid; the release makes new ones on its own (`-allowProvisioningUpdates`).

The extension needs no app record of its own in App Store Connect: it ships inside the app.

### Google Play

The two apps exist in Play Console. The Android Developer Console, where package names are
registered for apps outside Play, is not needed: Play registers its own apps.

1. **The upload key.** Play keeps the key the app is signed with (Play App Signing); the build
    signs with an upload key, which Google can reset if it is lost. One key serves both apps:

    ```bash
    keytool -genkeypair -v -keystore taskfest-upload.jks -alias upload \
      -keyalg RSA -keysize 4096 -validity 10000 \
      -dname "CN=Hilling IT GmbH, O=Hilling IT GmbH, C=DE"
    base64 -i taskfest-upload.jks | pbcopy    # -> ANDROID_UPLOAD_KEYSTORE
    ```

    keytool asks for one password: a PKCS12 keystore, the default since JDK 9, has no separate
    password for the key. The keystore and that password go into the password manager. The four
    `ANDROID_UPLOAD_*` secrets are what the build signs with: the base64 text,
    `ANDROID_UPLOAD_KEY_ALIAS` `upload`, and the password twice — Gradle asks for the keystore's
    and the key's separately, and here they are the same.

2. **Google Cloud, without a stored key.** The upload signs in to Google through Workload Identity
    Federation: GitHub's OIDC token for a job in `app-stores`, exchanged for a short-lived token of
    a service account. Nothing to leak or rotate, and new Google Cloud organizations refuse
    service-account keys by default anyway. With `gcloud`, in a project of its own:

    ```bash
    gcloud projects create taskfest-releases          # or any free project ID
    gcloud config set project taskfest-releases
    gcloud services enable androidpublisher.googleapis.com iam.googleapis.com \
      iamcredentials.googleapis.com sts.googleapis.com
    gcloud iam service-accounts create play-release --display-name "TaskFest Play releases"

    gcloud iam workload-identity-pools create github --location global --display-name GitHub
    gcloud iam workload-identity-pools providers create-oidc github \
      --location global --workload-identity-pool github \
      --issuer-uri https://token.actions.githubusercontent.com \
      --attribute-mapping google.subject=assertion.sub \
      --attribute-condition "assertion.sub == 'repo:guhilling@2537533/ai-assisted-todolist@1383592232:environment:app-stores'"

    number=$(gcloud projects describe taskfest-releases --format 'value(projectNumber)')
    gcloud iam service-accounts add-iam-policy-binding \
      play-release@taskfest-releases.iam.gserviceaccount.com \
      --role roles/iam.workloadIdentityUser \
      --member "principal://iam.googleapis.com/projects/$number/locations/global/workloadIdentityPools/github/subject/repo:guhilling@2537533/ai-assisted-todolist@1383592232:environment:app-stores"
    echo "projects/$number/locations/global/workloadIdentityPools/github/providers/github"
    ```

    The condition admits jobs in the `app-stores` environment of this repository and nothing else.
    The repository uses GitHub's *immutable subject*, so the token names owner and repository by
    name *and* id (`guhilling@2537533/ai-assisted-todolist@1383592232`), as the AWS deploy roles
    expect too; `gh api repos/guhilling/ai-assisted-todolist/actions/oidc/customization/sub` shows
    the prefix. A condition with the plain `owner/name` refuses every token ("rejected by the
    attribute condition").
    The last line is `GOOGLE_WORKLOAD_IDENTITY_PROVIDER`; the service account's email
    (`play-release@taskfest-releases.iam.gserviceaccount.com`) is `GOOGLE_PLAY_SERVICE_ACCOUNT`.
    None of it costs anything. A project only just created may refuse the pool for a few minutes,
    until its owner's role has reached every Google service: wait, and run the command again.

3. **Play lets the service account release.** Play Console → *Users and permissions → Invite new
    users*: the service account's email; under *App permissions* both apps, with **Release to
    testing tracks**. No account-wide permission.
4. **Testers**, per app: *Test and release → Testing → Internal testing → Testers*, an email list
    of Google accounts (up to 100). Each tester opens the opt-in link shown there once.
5. **The first bundle, by hand.** Play's API cannot upload an app's first build; the upload step
    says so with a warning, and the release still succeeds. Download the bundle from that run (*taskfest-qa-1.4.0-aab*, say), then
    *Internal testing → Create new release*, accept **Play App Signing** with a key Google
    generates, upload it and roll it out. From the next release on the workflow uploads by itself.

**While an app is still a draft** in Play Console — its setup tasks under *Dashboard* not done —
Play takes only draft releases. The upload then leaves the build as a draft on the internal track
and warns; roll it out in Play Console by hand, and finish the setup tasks so the next one goes out
by itself.

## What only a real release shows

The workflow cannot run without the accounts, so its first run is the test. Two things to look at
then:

- **iOS entitlements.** The archive is built unsigned and the export signs it, with the
  entitlements it finds in the archive's signatures, which unsigned has none. So the archive is
  signed ad hoc first, the app and the share extension each with the entitlements the project
  generates for it, App Group included (#356), and the export's `.ipa` is checked for the App Group
  before anything is uploaded (`.github/scripts/sign-with-app-group.sh`,
  `.github/scripts/check-share-extension.py`). `expo-notifications`' push entitlement is left out
  on purpose: the App IDs have no push, and push (#277) adds it.
- **Play's draft state**, above: whether the internal release went out or waits as a draft.
