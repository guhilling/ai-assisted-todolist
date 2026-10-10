# The account

What the website keeps in its header and footer, in the app (#275): who is signed in, signing out,
deleting the account, and the legal pages. **Account**, at the head of the board, opens it as a
sheet over the board.

## What it does

- **Who is signed in** — the address from the ID token's `email` claim, the one the backend keys
  the account by.
- **Sign out** — forgets the session on the phone (the tokens in the keychain) and everything shown
  for it, and goes back to the sign-in. Like the website's sign-out it leaves the provider's own
  session alone: it is not an RP-initiated logout, so signing in again may not ask for a password.
  The board kept for reading offline ([board.md](board.md)) and the scheduled reminders
  ([reminders.md](reminders.md)) go with it, and whatever else the app comes to keep for a
  signed-in user is removed in the same place,
  `signOut` in `mobile/src/TaskFestApp.tsx`, which every way to the sign-in goes through — a
  session the backend turns away too. A renewal under way is waited for before the keychain is
  cleared, and a start or a load begun before the sign-out gives up, so neither signs back in.
  While the sheet is open, coming back to the foreground does not start the app over: its own
  legal links leave the app, and a half-typed confirmation would be lost.
- **Delete account** — the website's confirmation, in its words: everything goes, for good, and
  the delete button stays disabled until the signed-in address is typed (in any case, with any
  spaces around it: the website's own rule, `frontend/src/confirmsEmail.ts`). It calls the website's endpoint, `DELETE /api/account`, with the ID token,
  then signs out and says the account was deleted; signing in again starts a new, empty one. A
  refused delete closes the question and says why; a session that has ended leads to the sign-in,
  as any change does ([board.md](board.md)). While the delete is on its way the sheet offers
  nothing else: no sign-out, and it cannot be closed, so a late answer can never sign out a
  session started in the meantime.
- **Imprint, privacy policy, terms** — the published pages, in the user's language, opened in the
  browser, and which release this is ("Development build" for a build from a branch). They are on
  the sign-in too, so they are reachable before signing in: the stores ask for the privacy policy
  to be one tap away inside the app. Apple also asks for an app with accounts to offer deleting
  one inside it (App Store Review Guideline 5.1.1(v)), which is why this came before distribution.

## Code and tests

| Piece | Where |
| --- | --- |
| The sheet and its confirmation | `mobile/src/AccountScreen.tsx` |
| The legal links and the release | `mobile/src/LegalLinks.tsx` |
| Signing out and deleting, and what a failure leads to | `mobile/src/TaskFestApp.tsx` |
| The request | `deleteAccount` in `mobile/src/api.ts` |
| The addresses of the legal pages, shared with the website | `frontend/src/links.ts` |

The behaviour is tested in `mobile/src/TaskFestApp.account.test.tsx`; `mobile/maestro/account.yaml`
opens the sheet, asks to delete and keeps the account, and signs out on an emulator. The backend's
`BearerTokenTest` checks that the app's token can delete its own account.
