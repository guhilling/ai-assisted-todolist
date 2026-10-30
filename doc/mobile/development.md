# Development

## One app, three variants

`APP_VARIANT` chooses the build (`mobile/src/variants.ts`, read by `mobile/app.config.ts`). The three
install side by side, each with its own bundle id, name, URL scheme and backend:

| Variant | Bundle id | Backend | Signs in with |
| --- | --- | --- | --- |
| `dev` (the default) | `de.hilling.taskfest.dev` | the end-to-end stack on `localhost:3000` | the local Keycloak, client `taskfest-app` |
| `qa` | `de.hilling.taskfest.qa` | `https://taskfest-qa.cloud.hilling.de` | qa's Cognito test accounts — once the app's Cognito client exists |
| `prod` | `de.hilling.taskfest` | `https://taskfest.cloud.hilling.de` | nobody yet: Google sign-in is #280 |

The scheme is the bundle id, so a sign-in in the browser returns to the variant that started it.
Only the `dev` build may talk plain HTTP, and only to localhost.

## Native projects are generated

`ios/` and `android/` are made by `npx expo prebuild` from `app.config.ts` and are never
committed ([decisions/mobile-app.md](../decisions/mobile-app.md)). Anything native about the app
is said in `app.config.ts` or a config plugin, never by editing a generated project.

## Running it

The `dev` variant runs against the end-to-end stack
([local-development/end-to-end-stack.md](../local-development/end-to-end-stack.md)):

```sh
docker compose -f deployment/docker/docker-compose.e2e.yml up -d --wait
cd mobile && npm install
npx expo run:ios          # needs Xcode; the simulator shares the Mac's localhost
npx expo run:android      # needs the Android SDK and an emulator, then:
adb reverse tcp:3000 tcp:3000 && adb reverse tcp:8082 tcp:8082
```

`adb reverse` gives the emulator the Mac's ports on its own `localhost`, so the app reaches the
stack and Keycloak at the same addresses the browser does — and the tokens' issuer,
`http://localhost:8082/realms/taskfest`, is the one the backend expects. Sign in as `gunnar` /
`gunnar` ([authentication.md](../authentication.md)).

## What it shares with the website

`mobile/src/web.ts` is the one place the app takes code from `frontend/src`: the generated wire
types and validators, the de/en texts, and the date and importance rules. They are imported
directly — Metro watches `frontend/src`, and Jest resolves their few imports from the app's own
`node_modules` — so the app shows the board in the website's words and order without a copy.

**All texts live in one catalogue**, the website's `frontend/src/i18n/messages.ts`: the app has
none of its own. A text only the app shows goes there too, in German and English, with a comment
saying it is the app's. The catalogue's test (`messages.test.ts`) reads the app's code as well as
the website's, so an entry is kept while either side shows it and fails the test once neither
does. Website CI therefore also runs when `mobile/src` changes.

The colours live in the website's CSS, which React Native cannot read; `mobile/src/theme.ts`
repeats them and `theme.test.ts` compares the two.

The icons are the website's mark ([decisions/frontend.md](../decisions/frontend.md)):
`doc/images/generate.py` writes their SVG sources to `mobile/assets/icons/`, and
`mobile/assets/render-icons.sh` turns them into the PNGs `app.config.ts` names — the iOS icon and
Android's adaptive icon, with its mint background and a single-colour version for themed icons —
and the white status-bar icon of the reminders.

## Older than its backend

An installed app is weeks older than the backend it talks to, so it is built to cope (#268,
[releasing.md](../releasing.md#which-number-to-raise)):

- every request names its release in `X-TaskFest-App`, which the backend's request log records as
  `app`, so it can be seen which releases still call what;
- at start, and whenever it comes back to the foreground, it asks `GET /api/version` for
  `minimumAppVersion` — alongside reading the kept session, and for three seconds at most — and,
  when it is older, asks its user to update instead of failing on an API it no longer matches. A
  build from a branch (`0.0.0`) is never too old, and an answer it cannot get locks nobody out;
- an importance or state it does not know, which a newer backend may add, is read as unknown and
  marked on the board, not refused: the task stays open and is ordered as the least important.

The version is `TASKFEST_VERSION`, which `app.config.ts` makes the app's version. The release
build sets it from the tag, and the build number beside it ([Distribution to testers](distribution.md));
every other build is `0.0.0`, which no minimum version locks out. It is a bare `major.minor.patch`,
since that is all an iOS app's version may be, and the backend logs nothing else as an `app`;
`src/release.ts` refuses anything else.

## Tests and CI

- **Unit and component tests** run on Jest with `jest-expo` and React Native Testing Library:
  `npm test`, or `npm run test:coverage`, which fails below the floor in `package.json`. As
  everywhere in this project, the test comes first.
  A test may take up to 15 seconds (`testTimeout`): the first in a file pays for loading the app,
  which on CI's runners with coverage took longer than Jest's default 5 more than once.
- **`npm run lint`** (oxlint, the frontend's rules), **`npm run typecheck`**, and
  **`npm run check:deps`** — the frontend's pre-release check, run on the app's lockfile.
- **Maestro** flows under `mobile/maestro/` drive the built app on an emulator: `sign-in.yaml`
  signs in and sees the board, `change-tasks.yaml` changes it and `keyboard.yaml` adds a task
  with the keyboard open ([board.md](board.md)), and
  `account.yaml` opens the account sheet and signs out ([account.md](account.md)). The two flows in
  `offline/` run after the account flow, one at a time: the first loads a board, then `run-on-emulator.sh`
  removes the `adb reverse` the app reaches the backend through — airplane mode alone does not cut
  it — and the second reads the kept board and has a change refused ([board.md](board.md)). Between
  the two, `reminders/turn-on.yaml` turns the reminders on, and the script checks Android holds the
  app's alarm ([reminders.md](reminders.md)); then `attach.yaml` attaches an image the script put in
  the emulator's Downloads, through Android's file picker, and sees it on the board
  ([files.md](files.md)). The app reaches the stack's storage as the browser does, at
  `s3.localhost:4566`, through one more `adb reverse`.
- **On iOS**, the flow in `maestro/ios/` shares a photo from Photos into the app through the real
  share sheet, on an iPhone simulator, with no stack behind it ([sharing.md](sharing.md));
  `maestro/ios/run-on-simulator.sh` boots the simulator and runs it.
- **Live**, after every deploy to qa, the flows in `maestro/live/` run the released qa app against
  qa itself, signed in as a Cognito test account, and are recorded
  ([live.md](../testing/live.md)).

`.github/workflows/mobile-ci.yml` runs all of it on every pull request touching the app or what
it shares with the website: the checks; a release APK of the `dev` variant on Linux; an iOS
simulator build on macOS, which then shares into the app on a simulator; and the Maestro flows on an Android emulator against the end-to-end
stack, built from the same commit. The flows run in two shares at once, each on an emulator and a
stack of its own: `board` signs in, changes the board and shares into the app, `others` has the account, the reminders,
attaching a file and the offline board. Their screenshots are the `maestro-output-board` and
`maestro-output-others` artifacts.

The APK the flows run is built for the emulator's x86_64 only, with Gradle's cache kept between
runs (`gradle/actions/setup-gradle`, written from `main`). It is not built at all when nothing it
is made from has changed — the app, the website's sources it bundles, the workflow; the flows and
tests aside: the APK of the run that last built it is kept in the Actions cache under a hash of
those files, so a pull request touching only the backend goes straight to the flows. The iOS
build is kept the same way, signed and checked, under a hash of the same files and the scripts that
check and sign it: on a hit the `ios` job skips installing, generating and building — about eight
of its twenty minutes — and goes straight to the share on the simulator. The stack
starts in the background, so it comes up while the emulator is set up and boots — Postgres,
Keycloak and LocalStack first thing, since they need nothing built — and `maestro/seed-stack.sh`
waits for it before putting the CI task on the board, due today. The flows find it under "Today",
so a run that would seed in the last quarter of an hour before midnight UTC waits for the new day
first (#407).

Before the flows the emulator is readied for them (#407). `emulator-ready.sh`, which the live run
shares, gives Chrome, which the sign-in goes through, its flags in
`/data/local/tmp/chrome-command-line`: no first-run screens, during which Google Play services
restarting had taken Chrome down mid sign-in, and the page's accessibility tree always built, which
had left Keycloak's form invisible to Maestro while it was on screen. It still did once, and Chrome
was once killed as it opened the page, the emulator out of memory (#420): the emulator has 4096 MB
since, and `maestro/sign-in.yaml` retries the sign-in with the launch, each try with Chrome and
the app started afresh. `run-on-emulator.sh` then keeps the screen on and switches Android to
three-button navigation, since a tap on the share sheet's bottom row had been taken for a gesture.

The emulator's setup is cached (#302): the API 34 system image and an AVD with a booted snapshot,
in a private image on GitHub's Container Registry, `ghcr.io/guhilling/taskfest-buildcache`, tagged
`avd-<API level>-<image>-<arch>-emu<emulator version>-img<image revision>-<hash>`. The emulator's
settings live in `maestro/emulator.env` for the three workflows that boot it; the hash covers
that file and `maestro/emulator-cache.sh`, and the versions are the newest stable ones in
Google's package index (`.github/scripts/android-revisions.py`), since the emulator action always installs those and a
snapshot only loads into the pair that saved it. `emulator-cache.yml` writes it, from `main` only:
on a push that changes the setup, daily — so a new emulator from Google is cached before many pull
requests boot cold — and from the Actions tab. The emulator jobs restore it, boot from the snapshot
and save nothing back. Without it — a tag not built yet, the registry out of reach, a broken
download — they set the emulator up and boot it cold, as before; a snapshot the emulator cannot load
on another runner's CPU is a cold boot too. A snapshot may wake with the day it was saved, so
`run-on-emulator.sh` sets the emulator's clock from the runner's when they differ.

It is private because the system image is Google's, under the Android SDK licence. GitHub's API does
not tell a workflow's own token a package's visibility, so the script asks the registry without
credentials, which a private package refuses: it reads a probe image that way on every run of
`emulator-cache.yml`, before the emulator boots, and again just before it pushes the setup. The
Actions cache is no place for it: at 10 GB it is full already, and the image would push out the
Gradle cache.

The package is created by hand, never by a workflow: one a workflow creates from this public
repository starts out public, and a public package can never be made private again — the first one
had to be deleted. To create it, or again after deleting it, push the probe with
[oras](https://oras.land) and your own token, which needs the `write:packages` scope
(`gh auth refresh -s write:packages` adds it):

```bash
gh auth token | oras login ghcr.io --username <your GitHub user> --password-stdin
GITHUB_REPOSITORY_OWNER=guhilling GITHUB_REPOSITORY=guhilling/ai-assisted-todolist \
  bash mobile/maestro/emulator-cache.sh probe
```

It fails unless the new package refuses an anonymous reader. The probe's label links the package to
this repository; should `emulator-cache.yml` still be refused writing it, add the repository under
*Manage Actions access* in the package's settings, with the *Write* role.
