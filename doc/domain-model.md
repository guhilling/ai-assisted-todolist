# Domain model

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| **Task** | A single thing its owner means to get done. With its attachments, the only thing this application stores on anyone's behalf. |
| **Owner** | The user a task belongs to. Every task has exactly one, and it never changes. |
| **User** | Someone who owns tasks, identified by the email claim in their OIDC token. |
| **State** | Whether a task is open (`TODO`) or done (`DONE`). `WORKING`, "in progress", is no longer offered (#334): the tasks that had it became open, and it stays in the API only until #345, because apps installed before then can still send it. The API accepts it and stores it as `TODO`, so no task is in progress again. |
| **Importance** | How much a task matters to its owner: `LOW`, `MEDIUM` or `HIGH`. |
| **Due date** | The day a task is meant to be finished. Always set, once the task is no draft. It keeps that meaning when the task also has a due time. |
| **Due time** | The time of day, to the minute, a task is due at on its due date (#474). Optional: a task without one is **all day**, as every task was before. A time already past today is allowed. |
| **Time zone** | The IANA zone a due time is meant in, such as `Europe/Berlin` (#474). Optional, and only with a due time. A due time without one is **floating**: it follows whoever's clock reads it, like "take the pills at 08:00", wherever the owner is. A due time with one is **zoned**: one moment, like a meeting at 10:00 in Berlin, which is 04:00 in New York. |
| **Due at** | The moment a zoned task is due at. Worked out on every read and never stored; an all-day or a floating task has none. A time that falls in a daylight-saving gap moves later, and one that falls in an overlap is its earlier moment, as `ZonedDateTime.of`, RFC 5545 and Temporal all resolve it. |
| **Draft** | A task the app's add form attaches files to before Add, so they upload while the form is filled in (#381). A task with a draft marker, not a state: it has made no progress, and has no description or due date yet. Nowhere a task is seen -- not on the board, not to an update or delete -- until it is added; discarded with its files on Cancel, swept with them once abandoned for an hour. At most five are open per user; a sixth is refused (#434). |
| **Board** | A user's tasks, as they see them: ordered by due date, and within a day by importance, high first. |
| **Attachment** | A file or a link on a task. A file is a PDF or an image, its content in object storage and its name, type and size here; a link (#414) is its address and title here, and nothing in storage. |
| **Link** | An attachment that is a web address, titled by its page where the app that shared it gave the title. Available as soon as it is added: there is nothing to upload. |
| **Pending** | An attachment announced but not yet confirmed: its upload link is handed out, the file may or may not have arrived. Never listed. |
| **Available** | An attachment the board lists and opens: a file once it has arrived as announced, a link as soon as it is added. |
| **Thumbnail** | A small JPEG of an image attachment, made by the browser when the image is uploaded; what the board shows on the row. Part of its attachment, not a thing of its own. |
| **Detached** | An attachment whose task was deleted, kept for the undo window in case the deletion is undone. |
| **Account deletion** | A user deleting their own account: every task, every attachment and the user go at once, with no undo. |
| **Deletion record** | What an account deletion leaves behind: a hash of the email and the time, kept outside the database so a restored backup cannot bring the account back. |

Note the deliberate absence of "todo" as a noun. The code says *task* throughout, and the
REST resource is `/api/tasks`. An earlier iteration used `/api/todos`; the rename is
complete in the code and any remaining "todo" in prose means the product, not the entity.

## Aggregates

**Task is the aggregate root.** It holds a reference to its owner but nothing else refers
to it, and it is always loaded, changed and deleted as a whole. There is no partial update
endpoint: a change sends the whole task back.

**User is a separate aggregate**, and a thin one. It exists to give tasks something to
belong to and to give the application a stable identity for the email arriving in a token.
The reference from `Task.owner` crosses an aggregate boundary, which in a larger system
would argue for holding an id rather than an object; at this size the object reference is
plainly better and the trade is made knowingly.

**Attachment is its own aggregate**, not part of Task's, although it is meaningless without one.
Two things force that. A file's content lives in S3, which cannot join a database transaction, so
uploading is three steps -- announce, PUT straight to S3, confirm -- that each change the
attachment and never the task. And it outlives its task for the undo window: deleting a task
*detaches* its attachments (`task` set to null, `detachedAt` set), and the undo, which re-creates
the task, names them in `attachmentIds` to attach them again. A sweep deletes what stays detached
past the window, and uploads that were never confirmed.

## Invariants, and where each is enforced

| Invariant | Enforced by |
| --- | --- |
| A task always has an owner | Not-null column and `@ManyToOne` on `Task.owner`; the owner is set from the token, never from the request |
| A task's description is present and at most 255 characters | `@Size` and `isCompleteUnlessDraft` on `Task`, `@NotBlank` + `@Size` on the request records **and on `TaskResponse`**, the `task_complete_unless_draft` check constraint, and `maxLength` in the published schema, which the frontend enforces on every response. A draft has none yet |
| A draft is never seen as a task | Every query in `TaskResource` that is not about drafts excludes them (`draft = false`); `DraftResource` reaches drafts only |
| A user has at most five open drafts (#434) | `DraftResource.create`, which counts them under the lock on the user's row (`User.lockRow`) |
| A **new** task's due date is today or later, in someone's zone: no earlier than today in UTC-12 (#425) | `@TodaySomewhere` on `TaskCreateRequest` only |
| A time zone comes only with a due time (#474) | `@ZoneOnlyWithTime` on both request records, and the `task_zone_only_with_time` check constraint |
| A time zone is one the JVM knows by its IANA name, never an offset: neither a bare one like `+02:00` nor one by name like `Etc/GMT-2` or `EST`, UTC excepted | `@KnownTimeZone` on both request records, and a 64-character column. A stored zone the running JVM does not know gives the task no `dueAt` rather than failing the board |
| A due time is to the minute | `DueTimeDeserializer`, which reads it only as `HH:mm` text, `00:00` to `23:59`, and the same `pattern` in the published schema. The `TIME(0)` column keeps seconds, so it is not what holds this |
| State and importance are always set | Not-null columns; `state` defaults to `TODO` |
| A user's email is present and unique | `@NotBlank` and a unique not-null column on `User` |
| A user's name and picture are **not** domain state | Nothing persists them; they are read from the token per request |
| A user sees and changes only their own tasks | Every query in `TaskResource` carries an owner predicate |
| An attachment is a PDF, JPEG, PNG, WebP or GIF file, or a link (#414) | `AttachmentKind`, a file's checked on announce, and a native enum column |
| A link has a web address and no object; a file has an object and no address | `LinkRequest`'s pattern, and the `attachment_link_or_file` check constraint |
| An attachment is at most 10 MB, at most 2 per task, at most 5 per user | `AttachmentPolicy`, counting pending, detached and drafts' ones too; the size is also signed into the upload link, so S3 refuses any other |
| A user can delete only their own account | `DELETE /api/account` acts on the caller and takes no id |
| A deleted account stays deleted after a restore | `DeletionReplay` deletes again, during every start, any account a deletion record names that was created before the deletion |
| A user sees and opens only their own attachments | Every lookup in `AttachmentService.find` carries the owner and the task, and a download link is only signed for a found one |

That first one used to read "a task's due date is today or later", enforced on the entity as
well as the request. It was wrong, and quietly so: Bean Validation runs on flush, so a stored
task became invalid the day after it came due, and because the update endpoint replaces the
whole task, every overdue task turned un-editable — including the state change that marks it
done. The rule a board actually wants is "do not *file* something in the past", which is a
create-time rule. See [decisions/domain-and-backend.md](decisions/domain-and-backend.md).

The ownership one is worth dwelling on. Ownership is part of the *query*, not a check performed
after loading. A task belonging to someone else is therefore indistinguishable from one
that does not exist — both yield 404 — which leaks nothing about other users' data.

## Rules that deliberately do not exist

- **No state machine.** Any state may follow any other. A personal todo list gains nothing
  from forbidding `DONE` → `TODO`, and everything from letting someone correct a misclick.
- **Importance orders, it does not group.** Within one due date, high comes before medium before
  low, and creation order breaks ties (#217) -- the backend's list and the board sort alike. Across
  dates it has no effect: the due date is what people plan against, so a low task due today stays
  above a high one due tomorrow. Otherwise importance sets the colour and fill of a dot on the row.
- **No soft delete, no history.** A deleted task is gone. `createdAt` and `updatedAt` exist
  for operational sanity, not as a domain concept. The one exception is its attachments, which
  wait out the undo window detached, because a file once deleted from S3 cannot be brought back
  by re-creating the task the way its fields can.
- **No registration.** A `User` row appears the first time an authenticated request arrives
  with an email the application has not seen. See `UserService.getOrCreateByEmail`, which
  is a check-then-act: the unique email constraint decides the winner when two first
  requests arrive together, and the loser re-reads instead of failing.

## Persistence

`Task` maps to `task`, `User` to `app_user` (`user` is reserved in PostgreSQL), `Attachment`
to `attachment`, whose file is the S3 object named by its `objectKey`, a random UUID. Both are
Panache active-record entities. The schema is created and evolved by Liquibase changelogs
under `backend/src/main/resources/db/changes/`; the third of these is the `todoitem` →
`task` rename, which is why the changelog history and the current model differ in naming.
