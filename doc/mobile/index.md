# Mobile app

TaskFest's app for iOS and Android, under `mobile/`: an [Expo](https://docs.expo.dev/) app
(React Native, TypeScript), decided on epic #264 and recorded in
[decisions/mobile-app.md](../decisions/mobile-app.md). It shows the same board as the website, in
the same words and colours, and signs in the way a native app should.

So far it signs in and shows the board, read-only (#267). Editing, offline reading, reminders,
attachments, push and distribution are the further stories of #264.

- [Development](development.md) — the variants, running the app, the tests and CI
- [Sign-in](sign-in.md) — how the app signs in, and how long it stays signed in
