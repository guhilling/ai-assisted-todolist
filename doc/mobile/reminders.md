# Due-day reminders

The app reminds without a server (#273): local notifications it schedules itself
([decisions/mobile-app.md](../decisions/mobile-app.md)).

## What it does

- **One reminder at 08:00 on every day with open tasks due**, saying how many: "3 tasks due today"
  ("3 Aufgaben heute fällig"). A count rather than the descriptions, since it shows on the lock
  screen. Tapping it opens the app on the board.
- **Only open tasks count.** A completed task never reminds, nor one whose state this release does
  not know (#268) — a newer backend's state may be a closed one; an overdue task is the board's to
  show, and today's reminder is scheduled only until its 08:00 has passed.
- **Rescheduled from what the backend holds**, after every load and every change it agreed to, and
  replaced whole each time — the same view the board kept for offline reading comes from
  ([board.md](board.md)). So a task completed or moved never reminds. Replacements run one at a
  time, and one that would schedule exactly what is scheduled already does nothing.
- **At most 60 days ahead** are scheduled, the nearest first: iOS keeps 64 pending notifications per
  app and drops the rest, and the next load schedules further days.
- **Signing out, deleting the account and a session that ended clear them**
  ([account.md](account.md)).
- **08:00 on the phone's clock when they were scheduled.** A change of time zone is followed at the
  next load; following it at once, and reminders tied to a time zone, are #290's.

## Asking for permission

Not at the start. The first time the board shows an open task due today or later, a note above it
asks **"Get a reminder at 08:00 on days tasks are due?"**, with **Turn on** and **Not now**:

- **Turn on** brings up the system's own question, which iOS asks only once; allowed, the
  reminders are scheduled at once.
- **Not now** is remembered on the phone, and the note is not shown again — nor after a refusal in
  the system's question, which Android would let the app ask a second time.
- Without the permission — refused, or never given — nothing is scheduled and the app works as
  before. Turning them on later is the system settings' job.

On Android the reminders have their own channel, **Due today**, so they can be switched off there
without touching anything else, and the status bar shows the mark's single-colour form
(`mobile/assets/notification-icon.png`). They are scheduled as inexact alarms, so a reminder may
come a few minutes after 08:00: exact alarms need a permission Android grants only to clocks and
calendars.

## Code and tests

| Piece | Where |
| --- | --- |
| The rule: which days, which time, how many | `mobile/src/reminders.ts` |
| The platform: permission, channel, scheduling | `mobile/src/notifications.ts` (expo-notifications) |
| When they are scheduled, cleared and offered | `mobile/src/TaskFestApp.tsx` |

`reminders.test.ts` covers the rule, `notifications.test.ts` the platform's use, and
`TaskFestApp.reminders.test.tsx` the app's. On the emulator, `mobile/maestro/reminders/turn-on.yaml`
adds a task due tomorrow and turns the reminders on, and `run-on-emulator.sh` then checks that
Android holds a pending alarm of the app's for 08:00 in the emulator's time zone — any day's, since a
run may cross midnight.
