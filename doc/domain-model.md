# Domain model

## Ubiquitous language

| Term | Meaning |
| --- | --- |
| **Task** | A single thing its owner means to get done. The only thing this application stores on anyone's behalf. |
| **Owner** | The user a task belongs to. Every task has exactly one, and it never changes. |
| **User** | Someone who owns tasks, identified by the email claim in their OIDC token. |
| **State** | Where a task stands in the workflow: `TODO`, `WORKING` or `DONE`. |
| **Importance** | How much a task matters to its owner: `LOW`, `MEDIUM` or `HIGH`. |
| **Due date** | The day a task is meant to be finished. Always set. |
| **Board** | A user's tasks, as they see them: ordered by due date. |

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

## Invariants, and where each is enforced

| Invariant | Enforced by |
| --- | --- |
| A task always has an owner | Not-null column and `@ManyToOne` on `Task.owner`; the owner is set from the token, never from the request |
| A task's description is present and at most 255 characters | `@NotBlank` + `@Size` on both `Task` and `TaskRequest`, and a not-null column |
| A task's due date is today or later | `@FutureOrPresent` on both `Task` and `TaskRequest` |
| State and importance are always set | Not-null columns; `state` defaults to `TODO` |
| A user's email is present and unique | `@NotBlank` and a unique not-null column on `User` |
| A user sees and changes only their own tasks | Every query in `TaskResource` carries an owner predicate |

The last one is worth dwelling on. Ownership is part of the *query*, not a check performed
after loading. A task belonging to someone else is therefore indistinguishable from one
that does not exist — both yield 404 — which leaks nothing about other users' data.

## Rules that deliberately do not exist

- **No state machine.** Any state may follow any other. A personal todo list gains nothing
  from forbidding `DONE` → `TODO`, and everything from letting someone correct a misclick.
- **No effect from importance.** It colours the card and nothing else. Ordering is always
  by due date, which is what people actually plan against.
- **No soft delete, no history.** A deleted task is gone. `createdAt` and `updatedAt` exist
  for operational sanity, not as a domain concept.
- **No registration.** A `User` row appears the first time an authenticated request arrives
  with an email the application has not seen. See `UserService.getOrCreateByEmail`.

## Persistence

`Task` maps to `task`, `User` to `app_user` (`user` is reserved in PostgreSQL). Both are
Panache active-record entities. The schema is created and evolved by Liquibase changelogs
under `backend/src/main/resources/db/changes/`; the third of these is the `todoitem` →
`task` rename, which is why the changelog history and the current model differ in naming.
