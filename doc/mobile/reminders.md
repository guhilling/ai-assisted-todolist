# Reminders

The app reminds without a server (#273): local notifications it schedules itself
([decisions/mobile-app.md](../decisions/mobile-app.md)). Once at 08:00 on days tasks are due, and
at a task's time when it has one (#478).

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
- **At a task's time (#478)**, when it has one, saying how many tasks are due then and when: "A
  task is due at 10:30" ("Eine Aufgabe ist um 10:30 fällig"), "2 tasks are due at 10:30". Again a
  count, not the descriptions, and tapping it opens the board. Tasks due at the same moment share
  one reminder. A timed task still counts in its day's 08:00 summary.
  - **A floating task** ("pills at 08:00") reminds at its time on the phone's clock.
  - **A task tied to a time zone** reminds at its one moment, the `dueAt` the backend works out, so
    the app needs no time-zone database. Its reminder words that moment by the phone's clock: a
    10:00 Berlin task reminds in New York with "A task is due at 04:00".
- **At most 60 reminders** are scheduled, summaries and timed ones together, the nearest first: iOS
  keeps 64 pending notifications per app and drops the rest, and the next load schedules further
  ones.
- **Signing out, deleting the account and a session that ended clear them**
  ([account.md](account.md)).
- **08:00, and a floating task's time, on the phone's clock when they were scheduled.** A change of
  time zone is followed at the next load. Following it at once is #479's on Android. On iOS, whether
  a calendar trigger without a time zone would follow it by itself is still to be tried on an
  iPhone (#517, postponed): the simulator takes the Mac's time zone.

## Asking for permission

Not at the start. The first time the board shows an open task due today or later, a note above it
asks **"Get reminders for tasks that are due?"**, with **Turn on** and **Not now**. A line under it
says what comes and what may happen next (#336, #478): *At 08:00 on days tasks are due, and at a
task's time if it has one: how many tasks are due, not which. If your phone asks next, allow it.* Without it, the system's
question after **Turn on** came out of nowhere, on Android at least. "If", because Android 12 and
older never ask; and it does not name the app, since the phone's question names the installed
variant (*TaskFest QA*).

- **Turn on** brings up the system's own question where there is one — iOS, which asks only once,
  and Android 13 and later; allowed, the reminders are scheduled at once.
- **Either answer is remembered on the phone**, and the note is not shown again: Not now, and Turn
  on whatever the system's question then got — Android would let the app ask a second time after
  a first refusal, and the app does not.
- Whether the app may still ask is read from expo-notifications' `canAskAgain`, not its `status`:
  on Android 13 and later notifications are off until allowed, so expo reports `denied` before
  anyone was asked.
- Without the permission — refused, or never given — nothing is scheduled and the app works as
  before. Turning them on later is the system settings' job.

On Android the reminders have their own channel, **Due tasks**, so they can be switched off there
without touching anything else, and the status bar shows the mark's single-colour form
(`mobile/assets/notification-icon.png`). They are scheduled as inexact alarms, so a reminder may
come a few minutes late: exact alarms need a permission Android grants only to clocks and
calendars.

## Code and tests

| Piece | Where |
| --- | --- |
| The rule: which days, which time, how many | `mobile/src/reminders.ts` |
| The platform: permission, channel, scheduling | `mobile/src/notifications.ts` (expo-notifications) |
| When they are scheduled, cleared and offered | `mobile/src/TaskFestApp.tsx` |

`reminders.test.ts` covers the rule, `notifications.test.ts` the platform's use, and
`TaskFestApp.reminders.test.tsx` the app's. On the emulator, `mobile/maestro/reminders/turn-on.yaml`
adds a task due tomorrow and turns the reminders on, and `reminders/timed.yaml` adds one due
tomorrow at 09:00 (#478). `run-on-emulator.sh` then checks that Android holds pending alarms of the
app's for 08:00 and for 09:00 in the emulator's time zone — any day's, since a run may cross
midnight.
