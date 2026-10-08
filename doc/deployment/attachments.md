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
deletes those no attachment refers to, once they are older than **a day**
(`taskfest.attachments.orphan-margin`). Every deletion removes the object before its row, so a crash in between
leaves a row without an object, never the reverse. What does leave an object behind: an upload
whose pending row was swept while its file was still arriving, or a database restored from a
snapshot older than files written since. The margin is far beyond an upload link's ten minutes, so an
upload under way is never mistaken for one left behind.

**Three guards keep it from wiping the bucket**, which is unversioned and survives `down`
(`OrphanPlan`). A database holding no attachments at all deletes nothing: that is an environment
brought up empty. An object newer than the newest attachment in the database is spared: a database
older than the bucket is a restored one, and those files are not orphans to whoever restores the
right snapshot. And a run finding more orphans than
`taskfest.attachments.orphan-sweep.max-deletions` (100) deletes none and logs a warning, because a
mass deletion is likelier a mistake than a backlog. Each guard that holds is logged.

It logs what it deleted, as a count and the keys (random UUIDs, never file names). It also logs,
as a warning, any **available attachment whose object is missing**, which it does not repair:
deleting a row is a decision about someone's data, and the row is the one record of what was lost.
A pending attachment has no object yet by definition and is not reported.

## When it runs, and running it by hand

Five minutes after every start of the backend, then every 24 hours
(`taskfest.attachments.orphan-sweep.delay` and `.every`). The Compose stacks, which have no bucket,
switch it off with `TASKFEST_ATTACHMENTS_ORPHAN_SWEEP_EVERY=off`. So it runs on every deploy, and **running
it by hand is redeploying the running version**: `deploy-backend.yml` with the version that is up,
which rolls out blue/green with no downtime ([deploying.md](deploying.md)). Both task sets may run
it during the overlap; deleting an object that is already gone is harmless.

## What it costs

A run is one `ListObjectsV2` request per thousand objects plus one `DELETE` per orphan. At demo
sizes (at most five files a user) that is a single list request a day: S3 charges $0.0054 per
thousand list requests in Frankfurt, so the clean-up costs well under a cent a year. Storage itself
is $0.0245 per GB-month ([cost.md](cost.md)).
