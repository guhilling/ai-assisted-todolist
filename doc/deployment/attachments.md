# Attachment storage

The files people attach to tasks (#204) are objects in a private bucket per environment,
`taskfest-<env>-attachments` (`modules/environment/attachments.tf`). The browser moves the
content straight to and from it through presigned links;
[decisions/domain-and-backend.md](../decisions/domain-and-backend.md) says why. The bucket is
foundation: it survives `env.sh down`, and nothing in it is versioned or backed up, so a deleted
file is gone.

## Two sweeps keep it tidy

**The attachment sweep** (`AttachmentSweep`, every minute) works from the database. It deletes
attachments detached from a deleted task once the ten-minute undo window has passed, uploads
announced but never confirmed within an hour, and attachments whose task went without detaching
them. Each one goes object first, then row.

**The orphan clean-up** (`OrphanSweep`, #208) works from the bucket. It lists every object and
deletes those no attachment refers to, once they are older than **seven days**
(`taskfest.attachments.orphan-margin`). It deletes objects only, never a row. Removing an
attachment and the attachment sweep both delete the object before its row, so a crash between the
two leaves a row without an object, never an object without a row. What does leave an object
behind: an upload whose pending row was swept while its file was still arriving, or a database
restored from a snapshot older than files written since.

**One guard keeps it from wiping the bucket**, which is unversioned and survives `down`
(`OrphanPlan`): a database holding no attachments at all deletes nothing, and a warning says so.
That guard holds only until the first attachment exists -- after that, every file older than seven
days that no attachment refers to goes on the next hourly run. A database restored from an *older*
snapshot is not guarded against either: files written since it was taken are orphans to it, and go
after seven days. Both are what the alert is for, and Gunnar decided to rely on it rather than on a
stronger guard: a restore that was a mistake must be put right before the files go
([database.md](database.md)).

**Every run logs one line with its counts** -- objects listed, orphans found (of any age), objects
deleted -- as the fields `orphanSweepListed`, `orphanSweepOrphans` and `orphanSweepDeleted`.
Deleted keys are logged as well (random UUIDs, never file names). It also logs, as a warning, any
**available attachment whose object is missing**, which it does not repair: deleting a row is a
decision about someone's data, and the row is the one record of what was lost. A pending
attachment has no object yet by definition and is not reported.

**The alert** is a separate `WARN` line with the field `orphanSweepAlert=true`, written only when a
run finds more than two orphans older than an hour (`taskfest.attachments.orphan-sweep.alert-above`,
Gunnar's threshold). Older than an hour, because an upload whose row was written just after the run
read the rows looks like an orphan for a moment, and must not page anyone. Orphans are counted even
while the empty-database guard holds, so an empty database facing a full bucket alerts within the
hour. A separate line with a string field, rather than a threshold on the count, because CloudWatch
compares `mdc` values as the strings they are. A metric filter counts those lines and the alarm
`taskfest-<env>-orphan-alert` mails Gunnar through the environment's alerts topic
([observability.md](observability.md) has the setup).

## When it runs

Five minutes after every start of the backend, then **every hour**
(`taskfest.attachments.orphan-sweep.delay` and `.every`). The local container stack, which has no bucket,
switch it off with `TASKFEST_ATTACHMENTS_ORPHAN_SWEEP_EVERY=off`. Both task sets of a blue/green
deployment may run it during the overlap; deleting an object that is already gone is harmless.

## What it costs

A run is one `ListObjectsV2` request per thousand objects plus one `DELETE` per orphan. At demo
sizes (at most five files a user) that is one list request an hour, about 8,800 a year: S3
charges $0.0054 per thousand list requests in Frankfurt, so the clean-up costs about five cents a
year. Storage itself
is $0.0245 per GB-month ([cost.md](cost.md)).
