# The board

The app's one screen once signed in (#267, #271): the website's board, in the website's sections,
order, words and colours, and everything the website does with a task except files.

## What it does

- **Add a task** — the button below the board opens a form: the description, the due date, and the
  importance. The due date is one of the website's shortcuts (today, tomorrow, in one or two weeks)
  or any day from the platform's own calendar — a dialog on Android, a calendar in the form on
  iOS. A new task starts tomorrow, of medium importance, and not started, as on the website; it
  cannot be dated in the past, which the backend refuses.
- **Edit a task** — a tap on it opens the same form with its values, and with the state too: not
  started, in progress or done. An edit may date a task in the past, as on the website's.
- **Complete or reopen a task** — the circle in front of it, which a completed task shows ticked in the website's green.
- **Delete a task** — from its form, at once and without "are you sure?": an offer to undo stands
  below the board for eight seconds. **Clear completed** deletes every completed task the same way.
  Undo puts a task back with its files, as the website's does.

## How a change behaves

As on the website (`doc/decisions/frontend.md`):

- **A tick shows at once** and is taken back, with a message, when the backend refuses it.
- **An add or an edit waits for the backend.** The form stays open, saying "Adding…" or
  "Saving…", and closes once the backend has the task. Refused, it stays open with what was typed
  and says why.
- **A delete goes at once**, and a task the backend keeps comes back with a message.
- **A session that has ended is not a failure.** The change leads to the sign-in, saying the
  session expired, as the website does. Each change first renews an ID token about to run out
  ([sign-in.md](sign-in.md)), so a board left open does not sign itself out.

Every text, the app's own included, is in the website's catalogue ([development.md](development.md)).

## A task the app does not fully understand

A newer backend can add an importance or a state this release does not know (#268). The board
shows such a task, marked "Unknown", but offers no change to it — no circle, no form, and it is
left out of Clear completed — and says "Update the app to change this task". The backend replaces
a whole task on every save, so an older app saving it would overwrite the value it cannot show
with its stand-in.

## Code and tests

| Piece | Where |
| --- | --- |
| The board, its rows and the undo offer | `mobile/src/BoardScreen.tsx` |
| The form, for adding and editing | `mobile/src/TaskForm.tsx` |
| The platform's date picker | `mobile/src/DueDatePicker.tsx` |
| The changes, and what a failure leads to | `mobile/src/TaskFestApp.tsx` |
| The requests | `mobile/src/api.ts` |

Component tests cover each piece (`TaskForm.test.tsx`, `TaskFestApp.changes.test.tsx`), and the
Maestro flow `mobile/maestro/change-tasks.yaml` adds, edits, completes, deletes and undoes a task
in the built app, against the end-to-end stack.
