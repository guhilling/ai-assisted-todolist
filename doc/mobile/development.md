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

The version is `TASKFEST_VERSION`, which `app.config.ts` makes the app's version. Only the release
build will set it, from the tag (#276); until then every build is `0.0.0`, and the minimum version
has nothing to compare with. It is a bare `major.minor.patch`, since that is all an iOS app's
version may be, and the backend logs nothing else as an `app`.

## Tests and CI

- **Unit and component tests** run on Jest with `jest-expo` and React Native Testing Library:
  `npm test`, or `npm run test:coverage`, which fails below the floor in `package.json`. As
  everywhere in this project, the test comes first.
- **`npm run lint`** (oxlint, the frontend's rules), **`npm run typecheck`**, and
  **`npm run check:deps`** — the frontend's pre-release check, run on the app's lockfile.
- **Maestro** flows under `mobile/maestro/` drive the built app on an emulator: `sign-in.yaml`
  signs in and sees the board, `change-tasks.yaml` changes it ([board.md](board.md)).

`.github/workflows/mobile-ci.yml` runs all of it on every pull request touching the app or what
it shares with the website: the checks; a release APK of the `dev` variant on Linux; an iOS
simulator build on macOS; and the Maestro flows on an Android emulator against the end-to-end
stack, built from the same commit. Its screenshots are the `maestro-output` artifact.
