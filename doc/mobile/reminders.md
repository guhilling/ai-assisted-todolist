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
  count, not the descriptions, and tapping it opens the board. Tasks due at the same time share
  one reminder; on a day that skips an hour, a task in the skipped hour keeps its own, worded as
  the task has its time. A timed task still counts in its day's 08:00 summary. A floating one due
  at 08:00 has only the summary, as long as both move with the zone: not when a zoned task counts
  in that day's summary too, which then stays where it is. A zoned task due at 08:00 keeps its own
  reminder. A zoned task's summary is on the day of its moment on the phone's calendar.
  - **A floating task** ("pills at 08:00") reminds at its time on the phone's clock, worded as the
    task has it.
  - **A task tied to a time zone** reminds at its one moment, the `dueAt` the backend works out, so
    the app needs no time-zone database. Its reminder words that moment by the phone's clock: a
    10:00 Berlin task reminds in New York with "A task is due at 04:00".
- **At most 60 reminders** are scheduled, summaries and timed ones together, the nearest first: iOS
  keeps 64 pending notifications per app and drops the rest, and the next load schedules further
  ones.
- **Signing out, deleting the account and a session that ended clear them**
  ([account.md](account.md)).
- **08:00, and a floating task's time, follow the phone's time zone.** Every reminder is scheduled
  as a fixed moment, worked out on the phone's clock, and the next load works them out again.
  - **On Android at once (#479):** after a change of time zone, a receiver of the app's own moves
    every floating reminder -- the summaries and the timed tasks without a zone -- to its wall-clock
    time in the new zone, without the app being opened. After a flight, "pills at 08:00" is at the
    new zone's 08:00. A zoned task's reminder stays where it is: its moment is the same everywhere,
    and so does a summary that counts a zoned task, whose day is its moment's. A reminder whose new
    time is already over -- a flight east may land after it -- stays where it was, and comes late
    rather than not at all. One the app had already dropped as over -- this morning's 08:00 before a
    flight west -- is not there to move, and comes back only with the next load; nor does a
    floating 01:30 on the night the clocks go back pick the same of the two 01:30s as the app,
    which the next load puts right too. The receiver works beside expo-notifications' own service,
    not in it: should the app replace its reminders, or the phone reboot, at the very moment the
    zone changes, the next load is what puts them right. Changes that come quickly one after another
    are followed in their order, so the last zone is the one the reminders end up in.
  - **On iOS only at the next load.** Following a change by itself would take another kind of
    trigger, a calendar one without a time zone; whether that works is still to be tried on an
    iPhone (#517, postponed), since the simulator takes the Mac's time zone.

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
| Moving them with the time zone, on Android | `mobile/plugins/android/TimeZoneChangedReceiver.kt`, declared by `mobile/src/timeZoneReceiver.ts`, added by `mobile/plugins/withTimeZoneReceiver.ts` |

`reminders.test.ts` covers the rule, `notifications.test.ts` the platform's use, and
`TaskFestApp.reminders.test.tsx` the app's. On the emulator, `mobile/maestro/reminders/turn-on.yaml`
adds a task due tomorrow and turns the reminders on, and `reminders/timed.yaml` adds one due
tomorrow at 09:00 (#478). `run-on-emulator.sh` then checks that Android holds pending alarms of the
app's for 08:00 and for 09:00 in the emulator's time zone — any day's, since a run may cross
midnight. It then moves the emulator to Los Angeles and checks the alarms are at 08:00 and 09:00
there (#479): left where they were, they would be at midnight and 01:00, or an hour later in summer.
West, because a zone east of UTC could put tomorrow's 08:00 there before the moment of the check
late in the day, which the receiver rightly leaves alone; the emulator's own zone comes back
afterwards.
