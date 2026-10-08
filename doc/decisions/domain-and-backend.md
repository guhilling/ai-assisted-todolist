# Domain, backend and persistence

## Panache active-record entities

**Decision.** Entities extend `PanacheEntityBase`, expose public fields and carry their own
queries. No repository layer.

**Why.** It is the idiomatic Quarkus style, and Hibernate rewrites field access into
accessor calls at build time, so the public fields are not the encapsulation hole they look
like. A repository layer over two entities would be ceremony.

**Cost.** Checkstyle's `VisibilityModifier` check had to be switched off, and the domain
objects know about persistence.


## Liquibase, not Hibernate-managed schema

**Decision.** `quarkus.hibernate-orm.schema-management.strategy=validate`, with Liquibase
changelogs applied at startup.

**Why.** Schema changes should be reviewable artifacts checked in beside the code that
needs them, and the application should fail fast on a schema it does not recognise rather
than quietly adapting. The `todoitem` → `task` rename is the case that proves the point —
Hibernate would have created a second table and left the first.

**Rejected.** `import.sql` plus a generated schema, which was the starting point.


## The due-date rule applies to filing a task, not to changing one

**Decision.** `@FutureOrPresent` lives on `TaskCreateRequest` alone. It is gone from the
`Task` entity and absent from `TaskUpdateRequest`, so an overdue task can be edited and
completed while a new one still cannot be filed in the past.

**Why.** The old rule made a task un-editable the day after it came due. It sat on the entity
as well as the request, and Bean Validation runs on flush, so a stored task silently became
invalid as time passed — no edit required. Because the update endpoint replaces the whole task
rather than patching it, that took the state change down with it: ticking off something late,
which is the single most common thing anyone wants to do with a board, returned 400. Confirmed
by writing the test first and watching it fail with `Expected status code <200> but was <400>`.

**Why two records rather than validation groups.** `@Valid` validates the `Default` group only.
Putting `@FutureOrPresent(groups = OnCreate.class)` on a shared record and annotating `create`
with `@ConvertGroup(from = Default.class, to = OnCreate.class)` would validate the date rule and
*silently stop validating* `@NotBlank`, `@Size` and the `@NotNull`s. That failure is invisible —
the endpoint still works, it just stops rejecting rubbish. `TaskCreateRequest` and
`TaskUpdateRequest` duplicate four field declarations and cannot fail that way.

**Cost.** Two records to keep in step, and a `TaskFields` interface so `apply` still takes one
parameter type. Nothing stops a client backdating an existing task, which is a feature more
than a risk: correcting a date you typed wrong is now possible.


## The database defines the enums, and the changelogs were squashed to say so

**Decision.** `state` and `importance` are native PostgreSQL enum types, `task_state` and
`task_importance`, created in `001-baseline.xml`. That file is the whole schema as one
changelog, replacing the three that had built it up.

**Why an enum type rather than `VARCHAR`.** The column was `VARCHAR(16)` with no constraint, so
the database would have accepted `'BANANA'`. What stood between it and a bad value was Jackson's
deserialisation, Bean Validation, and the frontend's generated schema — all of them in the
application. That is fine while this application is the only writer, and it stops being fine the
moment anything else writes: a SQL client, a fix applied by hand, a second service. A column
whose legal values are written down in the database does not depend on who is doing the writing.

**Why the changelogs were squashed.** The sequence was todoitem, then app_user, then the
replacement of todoitem by task. No database it applied to outlived it — every environment here
is built from scratch — so the only thing the history added was having to read three files to
learn the shape of two tables. It cost a one-off reset, which [Troubleshooting](../local-development/troubleshooting.md) records,
because Liquibase refuses to run against a `databasechangelog` naming changesets that no longer
exist.

**What the mapping needs, and why both halves.** `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` makes the
driver send the enum rather than a `varchar` parameter, which PostgreSQL will not assign to an
enum column without a cast. `@Column(columnDefinition = "task_state")` names the type, because
Hibernate otherwise derives it from the Java class and looks for `taskstate`. Neither is
optional, and dropping either leaves an application that still compiles.

**The cost, stated rather than discovered.** Adding a value later is a new changeSet with
`ALTER TYPE ... ADD VALUE`, which PostgreSQL allows. Renaming or removing one is not: it needs a
new type and a column rewrite. That asymmetry is the price of the database enforcing the values,
and it is worth paying for a set of three that describes a workflow.

**The type and the Java enum are declared twice, so a test holds them together.**
`TaskEnumColumnTest` asserts that both columns really are enum types and that the type's labels
match the Java constants exactly, in order. Drift fails the build rather than the first request
that uses the new value — checked by adding a constant on one side and watching it fail, not
assumed.

**Rejected: a `CHECK` constraint.** It would have enforced the values with none of the
asymmetry above, and `ALTER TABLE ... DROP CONSTRAINT` would make changes easier. It was
rejected because a check constraint states the values in a condition rather than as a type:
nothing else can refer to it, `information_schema` does not describe it as a domain of values,
and every table wanting the same set repeats the condition. The enum is the thing PostgreSQL
has for this.

**Rejected: leaving it as `VARCHAR` and relying on the application.** That is what was there,
and the argument for it — only this application writes — is an argument that holds until it
does not.


## The schema carries the constraints, and every string has a bound

**Decision.** Jakarta Bean Validation annotations on the response records, not only on the
requests, with these bounds:

| Field | Max | Why that number |
| --- | --- | --- |
| `description` | 255 | The column width; the two must agree or a valid value is a 500 |
| `email` | 254 | RFC 5321: a 64-character local part, an at sign, a domain of up to 255 |
| display name | 255 | Not stored, so only the schema bounds it |
| any URL | 2048 | The practical ceiling browsers have long enforced |
| provider id | 64 | Our own configuration key, and short |
| provider label | 100 | A word or two on a button |

**Why bound them at all.** The frontend compiles these schemas into the validators it checks
every response with, so a bound written here is enforced in the browser. Before this, every
string on the wire was unbounded: `description` could exceed the column that stores it, and
nothing said an email was an email.

**Why standards-based rather than tighter.** A bound that rejects a legitimate value is worse
than one that is loose. A provider's picture URL carries size and crop parameters and is
routinely a few hundred characters; 2048 bounds it without guessing at a provider's habits.

**`@NotNull` replaced the hand-written required lists,** except where required and non-null
differ. `AuthProviderResponse.loginUrl` is required *and* null for an unusable provider, and
`available` is a primitive, so that record still lists its required properties on the type.

**Rejected: `Optional<T>` for the optional fields**, which issue #70 asked for. Measured rather
than assumed: a single `Optional` component costs the *operation* its schema reference. The
component schema survives, but `/api/auth/me` stops declaring what it returns, so Redoc and any
generator lose the link. `Optional` is used in service signatures instead, where it helps and
touches no schema.

**`@Email` turned out to be runtime-only.** SmallRye emits nothing in the schema for it, so the
document says what the string is through `@Schema(format = "email")`. The frontend registers
`email` as a regular expression, deliberately as loose as the backend's own constraint: a
stricter pattern would reject an address the backend had already accepted and stored.

**A side effect worth recording: no operation had declared its response schema.** Every
`@APIResponse` that specified `@Content` for its examples had suppressed the schema SmallRye
would otherwise have derived, so the document described five endpoints that returned something
unspecified. `OpenApiContractTest` now asserts the reference exists.

**The one cost.** `maxLength` makes Ajv's compiled validators call into `ajv/dist/runtime`,
which the generator previously refused outright. The check now allows Ajv's own helpers, which
Vite bundles at build time, and still refuses any other package: adding `format` through
`ajv-formats` would land there, which is why `date` and `email` are regular expressions. `ajv`
remains a devDependency and `dependencies` is still React alone. The bundle grew by 2.5 kB.


## Wire identifiers are constants, and a GET's query count is asserted

**Decision.** The OpenID Connect claim names this application reads live in `OidcClaims`, and
`TaskQueryCountTest` holds the list endpoint to a constant number of database statements.

**Why the claim names.** They were literals at each call site: `jwt.getClaim("email")`,
`jwt.getClaim("picture")`. A claim name is a wire identifier, and misspelling one compiles,
passes a test that stubs the token with the same misspelling, and surfaces only as an empty
field in the browser.

**What the standard library actually covers, since the issue asked.** MicroProfile JWT's
`Claims` enum names each claim by its own `name()`, so `Claims.email.name()` is `"email"` and
is used. It has **no `picture`**. It does have `full_name`, which is *not* OpenID Connect's
`name` claim — the constant is called `full_name` and so is the claim it stands for. So one of
the three is covered by the standard and two are declared here, with that written down so the
search is not repeated.

**Why the query count is a test rather than a rule.** The rule is that a GET runs a constant
number of statements — one ideally, two or three acceptable — and never a number that grows
with the rows returned. Nothing else notices when that breaks: the responses stay correct, the
tests stay green, and only the statement count moves. The change that causes it is usually
somewhere else entirely, so the count is what has to be asserted.

**The test's limits, stated rather than overread.** `Task.owner` cannot produce an N+1 however
it is fetched, because every task in one response belongs to the same user and that user is
already in the persistence context from resolving the caller — touching it per row costs
nothing. The test was validated against genuine per-row work instead, which took the count from
three to twelve and failed both assertions. Its value is in guarding what comes later: a
collection on `Task`, an association added to a response.

**Rejected: extracting every repeated literal.** The component names inside
`@Schema(requiredProperties = ...)` are repeated, and turning them into constants would make
them harder to read while protecting nothing a rename would not also break. The better answer
was removing most of those lists, which `@NotNull` on the components already did.

**Rejected: enabling Hibernate statistics everywhere.** Collecting them costs something and the
production application has no use for the numbers, so
`%test.quarkus.hibernate-orm.statistics=true` is test-only.



## Attachments live in S3 and travel straight between it and the browser

**Decision.** A task's files (#204) are S3 objects in a private bucket. The backend never sees
their content: it hands out presigned links, a PUT link to upload and a GET link to open, and
keeps the name, type, size and object key in the `attachment` table.

**Why presigned links.** Streaming files through the backend would make it pay for every byte
twice, hold ten megabytes in flight per upload, and put an object-storage proxy inside an
application that is otherwise a few JSON endpoints. A link signed for one object and a few
minutes is as confidential as the session that asked for it, and S3 checks it without the
backend's involvement.

**Why a PUT with the size signed, not a POST policy.** A browser POST with a policy document can
say "at most 10 MB", which is what limiting an upload is usually built from. The AWS SDK for Java
cannot sign POST policies at all, and a hand-written policy signer is exactly the code nobody
should own. A presigned PUT signs `Content-Length` and `Content-Type` instead, which is stricter:
S3 accepts exactly the announced file and nothing else, and refuses a byte more with 403. The
browser must therefore send those headers as signed, which `UploadResponse.headers` lists.
`AttachmentResourceTest` checks the refusal against LocalStack with signature validation
switched on -- LocalStack skips it by default, and the test then passed for the wrong reason.

**Why three steps, and the order of the halves.** S3 and the database cannot change in one
transaction, so every operation orders its two halves to fail safely. *Announce* writes the row,
pending, before the link exists, so no object can arrive that the database does not know about.
*Confirm* asks S3 whether the object is there with the announced size and type. *Remove* deletes
the object before the row, so a failure in between leaves a row pointing at nothing -- harmless,
and what the clean-up job of #208 finds -- rather than an object nobody can find any more.

**Why the limits count pending and detached attachments.** Otherwise announcing without
uploading, or deleting a task and creating another, would be a way around them. Counting and
inserting are serialised per user by locking the user's row, or a multi-file drop announcing in
parallel would have each request count the same total and all of them fit. Ten megabytes,
two per task and five per user (D1) are configuration, under `taskfest.attachments`.

**Why deleting a task detaches rather than deletes (D3).** The board's undo re-creates a deleted
task from what it still holds in the browser; for the fields that is a full restore, for a file
in S3 it cannot be. So `TaskResource.delete` detaches the task's attachments, the undo names them
in `attachmentIds`, and `AttachmentSweep` deletes, once a minute, what stayed detached past the
undo window (ten minutes, comfortably beyond the toast's eight seconds) and what was announced
and never confirmed within an hour. The foreign key is `ON DELETE SET NULL` besides, so a task
deleted any other way can never take a row with it whose object would then be lost track of; the
sweep deletes those rows, task gone and never detached, too. It re-checks each row under a lock
before deleting it, so a confirm or an undo that reached it since the sweep looked wins. An undo
re-attaches at most as many as a task may hold, whatever it names.

**Rejected: malware scanning (D4).** The files are only ever opened by the person who uploaded
them, so a scan would protect someone from their own file.

**A row shows an image by a thumbnail the browser made (#236, Gunnar's decision).** A photo of
several megabytes was scaled to a 64 px box on every board load. Now the browser, which has the
file anyway, draws a JPEG of it at 128 px on its shorter side while uploading, announces its size
with the file, and PUTs it next to the file through a second link, signed like the first for exactly
that size and `image/jpeg`. Confirming looks for it; `Attachment.thumbnail` says whether it came,
and `GET …/thumbnail-link` opens it. It lives under the file's key plus `.thumbnail`, so it needs no
row and goes wherever the file goes: removed, swept and counted as referenced by the orphan
clean-up with it. It is optional at every step -- not offered, over 64 KB
(`taskfest.attachments.max-thumbnail-bytes`), a PDF, or never arrived -- and the row then shows the
file. It does not count towards the limits: it is a few kilobytes, and its file already counts.
*Rejected: scaling in the backend*, which would have downloaded every photo from S3 again and
decoded up to 10 MB on a 1 GB task, with an image library for WebP besides. *Rejected: a Lambda on
the upload event*, the most moving parts -- a function to package, IAM, an event notification, an
apply -- for the same result. Images uploaded before #236 have none, and show the file.

**A link is handed out again while it is fresh (#236).** A browser caches a file by its URL, and a
newly signed link is a new URL each time, so every board load downloaded every preview again. Links
now work for an hour (`download-link-lifetime`), and `ReusedLinks` hands out the same one while at
least half of that is left. The answer carries `Cache-Control: private, max-age` up to that moment,
so the browser does not even ask again, and storage answers the GET with a `Cache-Control` of its
own (`response-cache-control`, signed into the link), so the file stays in the browser's cache. Each
backend task keeps its own links; with two, a browser may see two URLs for a file, which costs one
fetch. The price is that a link that leaks works for an hour rather than five minutes, to someone
who could only have got it from the owner's browser.


## Deleting an account leaves a record outside the database

**Decision.** A user deletes their own account (#213, Gunnar's decision; no admin role).
`DELETE /api/account` acts on the caller only. It writes a deletion record, then deletes each
attachment, file before row, and, in one transaction with the user's row locked, any remaining
attachment rows, the tasks and the user. The response expires this browser's session cookies.

**Why a record, and why outside the database.** The privacy policy promises that a deletion also
applies to a backup restored later, and the database is restored from snapshots routinely
(`env.sh up`, a rollback). A record kept in the database would be undone by the very restore it is
meant to survive, so it is a small object, `deleted-accounts/<SHA-256 of the email>`, in the
environment's attachment bucket, which a restore does not touch; its time is the object's own.
The attachment listing the orphan clean-up uses ignores everything under a prefix, so a record is
never taken for an orphan.

**Why the record comes first, and is taken back on failure.** Written first, there is no moment in
which the account is gone but unrecorded, which a crash or an S3 outage would otherwise leave for a
restore to undo. A deletion that then fails removes its record again before reporting the failure:
the user is told it did not happen, so the replay must not carry it out later, taking whatever was
added since. A crash between record and deletion leaves the record, and the replay finishes a
deletion the user did ask for. Where records are switched off (the local container stack, no bucket), the
account is deleted without one.

**Re-applying, before anyone can sign in.** `DeletionReplay` runs during start-up -- a restore
always comes with one -- and daily, and deletes again any account a record names that was created
*before* the deletion -- checked again under the row lock, so an account created meanwhile is never
taken for the restored one; someone who signed up again afterwards keeps theirs. The accounts are
found by hashing the emails in SQL, not by loading every user. Each record and account is handled
on its own, so one failure stops nothing else.

**A session left open elsewhere starts a new account (Gunnar's decision).** The session is an
encrypted cookie, so the server cannot end one another device holds, and that device's next request
creates the account afresh -- empty, exactly as signing in again would. A check comparing the ID
token's issue time with the deletion was built and dropped: Quarkus refreshes expired ID tokens,
which renews the issue time, and refusing the session left its cookie in place, so the user could
not sign in again. Making the promise hold would need a tamper-proof sign-in time of our own per
session; the deleted data stays deleted either way.

**How long a record is kept (Gunnar's decision).** Exactly as long as a snapshot or backup older
than the deletion exists: each run deletes the records older than the oldest restorable point of
the environment's database, from RDS's listing of its snapshots and retained backups, every page of
it (`RdsRestorePoints`). When that cannot be known -- RDS refused, listed nothing, or no instance is
configured, as everywhere but AWS -- nothing is pruned. A record whose account is still there (its
re-deletion failed) is kept, and a record rewritten since it was read stays. Pruning runs daily,
not at start-up, so RDS never stands between a start and the first request.

**A file still uploading can outlive the deletion (Gunnar's decision).** An upload link signed
before the deletion stays valid for up to ten minutes, and a file arriving through it has no row:
the orphan clean-up of #208 removes it within seven days. The privacy policy says so.

**The hash is pseudonymous, not anonymous.** It holds no address, but anyone who knows an address
can compute its hash and see that an account with it was deleted. That is said in the privacy
policy. A keyed hash (HMAC) would avoid it at the price of a secret to keep and rotate; for a demo
project the plain hash Gunnar chose is the proportionate answer.
