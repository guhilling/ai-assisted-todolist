# Frontend and user interface

## The board is the front page; the project description is a link

**Decision.** The signed-out page is an app name, one sign-in button and a link to
`doc/purpose.md` on GitHub. The old hero section — the tech-stack prose and the
"Backend / Frontend / Deployment" list — is gone. Signed in, the whole page is the board.

**Why.** The front page described the repository rather than doing anything, which put the
project's own explanation in the way of the app for the person using it daily. A link serves
the visitor who wants that explanation without charging the daily user for it.

**Why only the usable provider.** `AuthProviderResource` reports `available` per provider and
`loginUrl: null` when credentials are missing. The old UI rendered those as disabled cards, so
every deployment showed a dead "Configure credentials" button — in dev, a Google card that
could never work. The frontend now filters to `available`, which in practice leaves exactly
one: the profile decides whether that is Google or the local Keycloak.

**Rejected: redirecting automatically to that single provider.** It is the obvious move once
there is only one, and it was asked for. But this repository exists to be read, and bouncing
every anonymous visitor to an identity provider leaves nowhere to say so — the purpose link
would have had to live behind the sign-in it explains. One button is one click, and the page
costs nothing.


## A checkbox for done, a quiet marker for in progress

**Decision.** The round checkbox on each row toggles `TODO` and `DONE`. `WORKING` is set from
the row's overflow menu and shows as a `doing` chip. The enum is unchanged.

**Why.** Completing a task is overwhelmingly the common action and it should cost one click; a
three-value `<select>` charged three interactions for it. `WORKING` is real but rare, so it
belongs where rare things go. Keeping it out of the checkbox also keeps the checkbox honest:
a control that does not complete on the first click is a surprise, and makes "untick" ambiguous.

**Why optimistic.** The tick is applied before the server answers and rolled back if the save
fails. A round trip is perceptible, and a checkbox that lags feels broken rather than careful.
The rollback is what keeps it safe: a rejected change never leaves the board asserting
something untrue.


## The look follows hilling.it, and the calendar loads on demand

**Decision** (#139). The palette and the heading face come from hilling.it. Its heading blue
`#0367a5` is the accent, its green `#7fae1c` is a band along the top and, darkened to `#4d7a0a`,
the done tick. Quicksand sets the title and the section headings, and running text stays in the
system face. The layout is a step more compact than before, still on the 4px grid, with 44px
kept as the size of anything tapped. Due dates are picked from react-day-picker, in a popover
beside the date field.

**Why blue and not green.** The brand green is 2.6:1 against white, below the 3:1 a control
needs and far below the 4.5:1 text needs, so it cannot carry a button, a link or a label. The
blue is 6.0:1. Using green where it can only decorate keeps the brand without failing contrast.

**Why Quicksand only for headings.** It is a rounded display face. At body size its regular
weight is thin, and a heavier weight to compensate makes long task lists tiring to read.

**Why self-hosted.** Loading the face from Google Fonts would send every visitor's address to
Google, which the privacy policy would then have to say. `@fontsource-variable/quicksand` ships
one 28 kB file for every weight, from the same origin.

**Why the calendar is lazy.** react-day-picker is about 20 kB gzipped against a 75 kB board, and
the board's speed was an explicit requirement. Loaded on first use, it costs the first page load
nothing. The native date field stays alongside, so typing a date keeps working.


## Editing starts from the menu, and waits for the server

**Decision** (#156). **Edit** in the row's overflow menu turns the row into a form with the same
three fields as adding a task: description, due date and importance. Save sends them, while
Cancel and Escape discard. Completed tasks are read-only, and reopening one is how to change it.

**Why the menu, not the text.** The description is the checkbox's `<label>`, so clicking it
already ticks the task done. Making the same click start an edit would take away the larger
target for the common action, to serve a rare one. The menu is where rare things already go.

**Why not optimistic.** A tick is one click and has to feel instant. An edit is a form someone
has just filled in, so a moment's "Saving…" is expected. Keeping the form open until the server
agrees means a refused edit leaves what was typed in place to correct, instead of rolling the row
back and losing it.

**Past dates stay.** Unlike adding, the editor sets no `min` on the due date, matching the
backend's `TaskUpdateRequest`. A task that came due yesterday can have its text corrected
without having to move its date as well.

**Cost.** `WORKING` is now two clicks away and less discoverable. That is the trade, and it is
the right way round.


## Due dates are relative words, set from defaults

**Decision.** Rows say `Today`, `Tomorrow`, `Yesterday`, `3 days ago`, a weekday name inside
the week, then `31 Dec`. The board groups into Overdue / Today / Tomorrow / This week / Later.
Adding a task offers `Today`, `Tomorrow`, `In 1 week` and `In 2 weeks`, and defaults to
tomorrow.

**Why.** `Due 2026-12-31` requires arithmetic to read, and "what is late and what is today" is
the only question a todo list has to answer at a glance. Typing a date was also the slowest
part of adding a task; the default means the common case needs no date interaction at all.

**Why the logic takes today as a parameter.** `dates.ts` never reads the clock. Every function
receives today as an ISO string, so a render is a pure function of its inputs and the tests
need no clock faking. Dates are anchored at UTC midnight and handled as strings, because
`new Date('2026-10-26')` in a zone behind UTC is the 25th, and day arithmetic over a
daylight-saving change is off by one — both bugs that look like correct code.

**Cost.** The board reads the clock once per mount, so one left open overnight keeps yesterday's
headings until it is reloaded. Rows silently re-sorting under the pointer would be worse.


## Undo instead of a confirmation, and what it costs

**Decision.** Deleting a task is one click with no dialog. An offer to undo stands for eight
seconds. Undo re-creates the task through the API.

**Why not a confirmation dialog.** "Are you sure?" on every delete trains people to click
through it, so it stops protecting anything while still costing a click every time. An undo
is cheaper when you meant it and better when you did not.

**Two requests, not one.** Creating refuses a date in the past, so re-creating a task that was
already overdue would fail — and overdue tasks are exactly the ones people delete. `restoreTask`
therefore creates the task dated today and then corrects the date with an update, which does
allow the past. That asymmetry is deliberate and is the subject of its own entry above; this is
the first place it bit something other than the board.

**Cost, and it is a real one.** The task comes back with a **new id**. The server has no memory
of the old one. Nothing here refers to a task by id except the rows themselves, so the only
visible effect is where it lands among tasks that share a due date — but "undo" restoring
something that is not, strictly, the same record is worth knowing before anything starts
referring to tasks by id.

**Rejected: deferring the delete until the offer expires.** That would make undo a true cancel,
with no new id and no date repair. It was not taken because the task would still exist on the
server during the window, so a reload mid-offer resurrects something the user has already seen
disappear — a worse surprise than a changed id, and a silent one.


## Importance is a dot, and the word is still there

**Decision.** Importance renders as a dot at the head of each row's metadata line: hollow for
low, solid for medium, solid with a ring for high. The word is kept in the markup as
screen-reader-only text.

**Why.** `Importance: MEDIUM` on every row was noise on the thing people scan fastest. A dot
carries the same information in a glance and takes no width.

**Why fill as well as colour.** Colour alone fails for the colour-blind, in greyscale and in
high-contrast modes. The three levels differ in fill, so they are still three things without
any colour at all — and a screen reader gets the word rather than a decorative shape.

**Also.** `n` opens the add row from anywhere on the board, ignored while the caret is in a
field or a modifier is held, so it cannot swallow a typed letter or shadow a browser command.


## A task id is checked before it is put in a URL

**Decision.** `putTask` and `deleteTask` build their URL through `taskUrl`, which throws unless
the id is a safe integer, rather than interpolating whatever arrived.

**Why.** `readJson` ends with `as T`. That is an assertion, not a check, and TypeScript erases
it — so every field of every response is the right type only by claim. An `id` of
`"../../elsewhere"` or an absolute URL would have been interpolated straight into a `fetch`,
and the browser would have issued that request with the session cookie attached. SonarCloud
reports the path as API traversal and client-side request forgery.

**How much of a risk it actually was.** Small: the tainted source is this application's own
backend, and a backend able to return a malicious id can already do worse directly. The reason
to fix it anyway is that the check is three lines and the alternative is a frontend that
believes whatever it is told about where to send an authenticated request.

**It throws rather than coercing.** A task whose id is not a task id is a broken response.
Silently addressing a different task, or dropping the request, would both hide that.

**The root cause is larger and was not fixed here.** `as T` lies about every response, not just
this field. It is fixed by the next decision; the guard in `taskUrl` stays anyway, because
`putTask` and `deleteTask` take a `Task` from a caller and a caller can build one.


## Responses are validated against the schema the backend publishes

**Decision.** `api.ts` declares none of the shapes it receives. The types and the runtime
validators are both generated from `doc/api/schema/*.schema.json` by `npm run generate:api`,
and every response is checked before anything reads a field off it.

**Why.** `readJson` used to end with `as T`, which TypeScript erases — so every field of every
response was the right type by claim only. SonarCloud reported one consequence of that as
client-side request forgery, and the rule's own mapping says what to do about it: CWE-20 and
ASVS 5.1.4, *validate structured data against a defined schema*. Not encode the output, which
is what the previous attempt did.

**Why generated rather than a schema written by hand.** A hand-written validator is a second
description of the same shape, and `api.ts` already had the first: its `TaskState` and
`TaskImportance` carried comments saying the backend's enums and these "must be changed
together". That is a convention that depends on being remembered. The backend publishes the
schemas already (see `architecture.md`), so the frontend can check against the definition
instead of against a copy of it.

**Why Ajv compiled ahead of time.** Ajv's standalone mode turns a schema into ordinary
JavaScript at build time, so `ajv` stays a devDependency and `dependencies` remains React
alone. The generator *asserts* this rather than hoping for it: if the compiled output ever
needs an `import` at runtime, it fails and says so.

That assertion is why only the three response shapes get validators. Adding the request
schemas pulls in `maxLength`, whose compiled form needs a helper from `ajv` — and the requests
do not need checking here anyway, because the backend validates what it is sent and answers
400.

**Why `format: date` is a regular expression.** `ajv-formats` would be an import at runtime for
one format. A RegExp is inlined. It checks the shape and the ranges but not the calendar, so
`2026-02-30` passes — a due date that cannot exist is a backend bug that shows as an odd label,
not something a malformed response could exploit.

**Why a checked response is copied rather than returned.** `toTask` builds a new object, with
`id: Number(data.id)`. Past that point the id is a number because a check said so and `Number`
produced it. It is also where the safe-integer test belongs, because the schema cannot express
it: `format: int64` describes a range JavaScript has no exact numbers for.

**Extra fields are allowed, deliberately.** The schemas do not set
`additionalProperties: false`. A backend that starts sending a new field must not break a
frontend deployed before it; the parsers copy the fields the contract names and ignore the
rest.

**Rejected: zod or valibot.** Either would mean a runtime dependency and a third description
of the shape — hand-written schemas, derived types — which is the thing being removed. Ajv
consumes the published JSON Schema directly.

**Rejected: marking the SonarCloud finding a false positive.** It would have been defensible.
`Number.isSafeInteger` did reject every hostile value, and the finding is the engine failing to
recognise a guard rather than a reachable flaw. It was rejected because the rule was pointing
at something true: the frontend believed whatever it was told about every field, not just this
one.


## Spacing and type are scales, not values

**Decision.** `App.css` defines a strict 4px spacing grid and exactly four type sizes, and every
padding, margin, gap and font size in the stylesheet comes from them.

| | |
| --- | --- |
| Spacing | `--space-1` … `--space-16`, the number being the step count, so `--space-4` is 16px |
| Type | `--font-display` 2rem, `--font-title` 1.5rem, `--font-body` 1rem, `--font-small` 0.875rem |

**Why.** Colour was already tokenised and dark-mode aware; spacing and type were not. There
were **16 distinct pixel values** across padding, margin and gap and **ten** font sizes, mixing
`rem` with a stray `16px`. Most of the spacing was already a 4px multiple, which is what made
the outliers worth removing rather than accommodating: `7px`, `10px`, `14px`, `6px` were drift,
not intent.

**What actually moved.** Sixteen declarations changed value; the rest only changed to a token.
The largest were `.app-footer` 40 → 32, `.button-primary` 20 → 24, `.task-section` and
`.completed-section` 28 → 24, and the type collapse: `1.25rem` and `1.1rem` to body,
`0.8125rem`, `0.75rem` and `0.6875rem` to small. Verified by rebuilding the design-system bundle
and comparing the rendered cards before and after — the risk was `.user-avatar--initials` going
11px → 14px inside a 28px circle, and it fits.

**Four declarations are deliberately off the scale**, each with a comment saying so:
`:root`'s `font-size: 16px`, which defines what `1rem` means rather than being an entry in the
scale; `.visually-hidden`'s `margin: -1px`, part of the standard clip idiom; and the `2px` top
margins on `.task-check` and `.task-meta`, which are optical nudges that a scale step in either
direction visibly misaligns.

**Rejected: keeping every existing value and naming it.** A scale with `--space-7px` in it is a
list, not a scale, and gives the design agent no reason to prefer one value over another. The
point of a strict grid is that the next person has eight choices rather than sixteen.

**Rejected: a separate spacing token per component.** Tokens named for where they are used
(`--task-row-gap`) grow with the component count and stop composing; a step scale is reusable by
anything, including the layout the design agent writes around these components.

**The agent is told.** `.design-sync/conventions.md` carries both scales, and
`npm run check:conventions` already validates every name it lists, so the new tokens are covered
by the existing guard without changing it.


## Sign-in buttons follow Google's branding rules, and every provider looks alike

**Decision (#190).** The sign-in buttons stand one under another. Google's is Google's official
button, used as it comes from its branding assets — light or dark with the page — and every other
provider's button copies its neutral style: white with a grey outline (dark in a dark theme), 40px
high, *Sign in with …* beside an icon. The icon follows the provider's issuer (`providerIcons.ts`):
Google's own button for `accounts.google.com`, the TaskFest mark for a Cognito pool — qa's test
accounts — and a plain key otherwise.

**Why Google's button as it comes.** Google's rules allow its "G" only inside a complete button, in
its light, dark or neutral theme — never the app's blue — set in Google's font, and at least as
prominent as any other provider's. The asset has the text outlined, so no font is needed, and it
reads *Sign in with Google*; the other buttons say *Sign in with …* to match.

**Why not other providers' logos.** None has one meant for this: AWS's icons are licensed for
architecture diagrams, and the Cognito pool appears to users as "TaskFest test account" anyway.

**Why by issuer, not by id.** No provider is named in the frontend, as before; Google's rules belong
to Google as the identity provider, which the issuer says. A configurable `icon` per provider would
have done it too, at the price of an API change and a changed existing test.

