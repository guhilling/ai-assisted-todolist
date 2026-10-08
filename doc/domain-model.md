# Domain model

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| **Task** | A single thing its owner means to get done. With its attachments, the only thing this application stores on anyone's behalf. |
| **Owner** | The user a task belongs to. Every task has exactly one, and it never changes. |
| **User** | Someone who owns tasks, identified by the email claim in their OIDC token. |
| **State** | Where a task stands in the workflow: `TODO`, `WORKING` or `DONE`. |
| **Importance** | How much a task matters to its owner: `LOW`, `MEDIUM` or `HIGH`. |
| **Due date** | The day a task is meant to be finished. Always set. |
| **Board** | A user's tasks, as they see them: ordered by due date. |
| **Attachment** | A file on a task: a PDF or an image. Its content lives in object storage, its name, type and size here. |
| **Pending** | An attachment announced but not yet confirmed: its upload link is handed out, the file may or may not have arrived. Never listed. |
| **Available** | An attachment whose file has arrived as announced. The only kind the board lists and opens. |
| **Detached** | An attachment whose task was deleted, kept for the undo window in case the deletion is undone. |

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
Two things force that. Its content lives in S3, which cannot join a database transaction, so
uploading is three steps -- announce, PUT straight to S3, confirm -- that each change the
attachment and never the task. And it outlives its task for the undo window: deleting a task
*detaches* its attachments (`task` set to null, `detachedAt` set), and the undo, which re-creates
the task, names them in `attachmentIds` to attach them again. A sweep deletes what stays detached
past the window, and uploads that were never confirmed.

## Invariants, and where each is enforced

| Invariant | Enforced by |
| --- | --- |
| A task always has an owner | Not-null column and `@ManyToOne` on `Task.owner`; the owner is set from the token, never from the request |
| A task's description is present and at most 255 characters | `@NotBlank` + `@Size` on `Task`, on the request records **and on `TaskResponse`**, a not-null column, and `maxLength` in the published schema, which the frontend enforces on every response |
| A **new** task's due date is today or later | `@FutureOrPresent` on `TaskCreateRequest` only |
| State and importance are always set | Not-null columns; `state` defaults to `TODO` |
| A user's email is present and unique | `@NotBlank` and a unique not-null column on `User` |
| A user's name and picture are **not** domain state | Nothing persists them; they are read from the token per request |
| A user sees and changes only their own tasks | Every query in `TaskResource` carries an owner predicate |
| An attachment is a PDF, JPEG, PNG, WebP or GIF | `AttachmentKind`, checked on announce, and a native enum column |
| An attachment is at most 10 MB, at most 2 per task, at most 5 per user | `AttachmentPolicy`, counting pending and detached ones too; the size is also signed into the upload link, so S3 refuses any other |
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
- **No effect from importance.** It sets the colour and fill of a dot on the row and nothing
  else. Ordering is always by due date, which is what people actually plan against.
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
