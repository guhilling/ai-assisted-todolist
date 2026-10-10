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
  texts, date and importance rules: used, never copied. A text the app needs goes into
  `frontend/src/i18n/messages.ts`, for both languages.
- **The backend is sent the ID token**, never the access token (`src/api.ts`), and every response
  is checked with the generated validators before it is read.
- **Tokens live in the keychain** (`expo-secure-store`), never in AsyncStorage or a file.
- **Colours come from the website** (`src/theme.ts`, checked against `frontend/src/App.css`).
- **TSDoc on every module and exported type**, saying what it is for, as in `frontend/CLAUDE.md`.
- Test first: Jest with `jest-expo` and React Native Testing Library for logic and components,
  Maestro (`maestro/`) for the built app.
