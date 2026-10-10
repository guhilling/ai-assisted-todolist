# CLAUDE.md — mobile

The Expo app under `/mobile`. Read with the root `CLAUDE.md` (ask-don't-guess, TDD, DDD) and
`doc/mobile/`, which says how it is built, run and tested.

## Expo changes faster than anyone's memory of it

Expo ships breaking changes with every SDK. Before writing code against an Expo, EAS or React
Native API, read the docs for the SDK in `package.json` (`https://docs.expo.dev/versions/v<major>.0.0/`,
or any page with `.md` appended), not what you remember. Add Expo packages with
`npx expo install <package>`, which picks the version matching the SDK; never `npm install` one.

## Rules

- **`ios/` and `android/` are generated** by `npx expo prebuild` and never committed. Native
  configuration goes in `app.config.ts` or a config plugin.
- **Builds run on GitHub Actions, not EAS** (`doc/decisions/mobile-app.md`).
- **The website's code comes in through `src/web.ts` only.** Generated types and validators,
  texts, date and importance rules: used, never copied. **Every text is in the website's
  catalogue**, `frontend/src/i18n/messages.ts`, in both languages — one only the app shows too,
  with a comment saying so. Its test counts the app's code as a use, so an entry neither side
  shows any more fails it.
  There is deliberately no `shared/` package yet (`doc/decisions/mobile-app.md`).
- **Installed apps are older than their backend** (#268, `doc/releasing.md`). Every request names
  the app's release in `X-TaskFest-App`; the app checks `/api/version`'s `minimumAppVersion` at
  start and asks for an update when it is too old; and it reads an enum value it does not know as
  unknown instead of refusing the response.
- **No router yet.** One screen; `src/Main.tsx` is the root. Expo Router took the sign-in's return
  link for a page and remounted the app mid-sign-in, so it comes back only with screens to route.
- **Coverage has a floor** (`jest.coverageThreshold` in `package.json`): raise it when coverage
  rises, never lower it to land a change.
- **The backend is sent the ID token**, never the access token (`src/api.ts`), and every response
  is checked with the generated validators before it is read.
- **Tokens live in the keychain** (`expo-secure-store`), never in AsyncStorage or a file.
- **Colours come from the website** (`src/theme.ts`, checked against `frontend/src/App.css`).
- **TSDoc on every module and exported type**, saying what it is for, as in `frontend/CLAUDE.md`.
- Test first: Jest with `jest-expo` and React Native Testing Library for logic and components,
  Maestro (`maestro/`) for the built app.
