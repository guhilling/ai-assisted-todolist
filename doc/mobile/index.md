# Mobile app

TaskFest's app for iOS and Android, under `mobile/`: an [Expo](https://docs.expo.dev/) app
(React Native, TypeScript), decided on epic #264 and recorded in
[decisions/mobile-app.md](../decisions/mobile-app.md). It shows the same board as the website, in
the same words and colours, and signs in the way a native app should.

So far it signs in, shows the board — readable offline too — adds, edits, completes and deletes
tasks, attaches, shows, opens and removes their files, reminds at 08:00 on days tasks are due, and signs out
or deletes the account, with the legal pages one tap away (#267, #271, #272, #273, #275, #274).
Another app's Share opens a new task with what was shared (#355, #356).
Every final release goes to testers through TestFlight and Play internal testing (#276).
Push is the further story of #264.

- [Development](development.md) — the variants, running the app, the tests and CI
- [Sign-in](sign-in.md) — how the app signs in, and how long it stays signed in
- [The board](board.md) — what the app does with tasks, and how a change behaves
- [Files](files.md) — a task's images and PDFs: attaching, seeing, opening and removing them
- [Sharing into the app](sharing.md) — another app's Share: what it offers, and what a share becomes
- [The account](account.md) — signing out, deleting the account, and the legal pages
- [Due-day reminders](reminders.md) — the 08:00 reminder, and asking for its permission
- [Distribution to testers](distribution.md) — what a release uploads, and the accounts and keys behind it
