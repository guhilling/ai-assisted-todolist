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
(`OrphanPlan`): a database holding no attachments at all deletes nothing, because that is an
environment brought up empty, and a warning says so. A database restored from an *older* snapshot
is not guarded against: files written since it was taken are orphans to it, and go after seven
days. That is what the alert below is for -- a restore that was a mistake must be put right within
that week.

**The alarm is not built yet.** The log line below is its source; the CloudWatch metric filter,
the alarm and the SNS topic that mails Gunnar come with the alerting infrastructure. Until then the
count is in the log only.

**Every run logs one line with its counts** -- objects listed, orphans found (of any age), objects
deleted -- as the fields `orphanSweepListed`, `orphanSweepOrphans` and `orphanSweepDeleted`. The
alarm is to watch `orphanSweepOrphans` and mail Gunnar when it is above two (his threshold), within
the hour, days before anything is deleted. The orphans are counted even when the guard holds, so an
empty database facing a full bucket alarms too. Deleted keys are logged as well (random UUIDs,
never file names). It also logs, as a warning, any **available attachment whose object is
missing**, which it does not repair: deleting a row is a decision about someone's data, and the row
is the one record of what was lost. A pending attachment has no object yet by definition and is
not reported.

## When it runs

Five minutes after every start of the backend, then **every hour**
(`taskfest.attachments.orphan-sweep.delay` and `.every`). The Compose stacks, which have no bucket,
switch it off with `TASKFEST_ATTACHMENTS_ORPHAN_SWEEP_EVERY=off`. Both task sets of a blue/green
deployment may run it during the overlap; deleting an object that is already gone is harmless.

## What it costs

A run is one `ListObjectsV2` request per thousand objects plus one `DELETE` per orphan. At demo
sizes (at most five files a user) that is one list request an hour, about 8,800 a year: S3
charges $0.0054 per thousand list requests in Frankfurt, so the clean-up costs about five cents a
year. Storage itself
is $0.0245 per GB-month ([cost.md](cost.md)).
