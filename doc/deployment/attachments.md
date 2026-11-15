# Attachment storage

The files people attach to tasks (#204) are objects in a private bucket per environment,
`taskfest-<env>-attachments` (`modules/environment/attachments.tf`). The browser moves the content
straight to and from it through presigned links;
[decisions/domain-and-backend.md](../decisions/domain-and-backend.md) says why. Nothing in the
bucket is versioned or backed up, so a deleted file is gone. For the same reason the bucket carries
`prevent_destroy` (#435): a plan that would replace it — a renamed environment or project — fails
rather than relying on S3 refusing to delete a bucket that still holds files. It guards only while
the resource is declared: removing the declaration removes the flag with it. Retiring an environment
for good means taking the bucket out of that environment's state
(`tofu state rm module.environment.aws_s3_bucket.attachments`) and deleting it by hand — not
removing the line, which the other environment shares.

An image may have a **preview thumbnail** next to it (#236), a JPEG of a few kilobytes the browser
made, under the file's key plus `.thumbnail`. It is deleted with its file by everything below, and
the orphan clean-up counts it as referenced while its file's row exists.

**The Go backend keeps everything under `serverless/`** (#578): its files under
`serverless/attachments/`, its deletion records under `serverless/deleted-accounts/`, and its
functions' roles reach nothing else. The Quarkus backend's files and records are still at the top
level, where it left them when it went (#559, #557); nothing deletes them.

## What keeps it tidy

The Go backend's functions ([serverless.md](serverless.md#attachments)): `streams` deletes the files
of an attachment that goes, and `orphans`, hourly, deletes a file no attachment refers to once it is
seven days old, with the guard against an empty table and the alert, which the alarm
`taskfest-<env>-orphan-alert` mails Gunnar through the environment's alerts topic
([observability.md](observability.md) has the setup). The Quarkus backend's sweeps, which did the
same from the database, are described in
[this page in the tag `pre-serverless`](https://github.com/guhilling/ai-assisted-todolist/blob/pre-serverless/doc/deployment/attachments.md).

## What it costs

A run is one `ListObjectsV2` request per thousand objects plus one `DELETE` per orphan. At demo
sizes (at most five files a user) that is one list request an hour, about 8,800 a year: S3
charges $0.0054 per thousand list requests in Frankfurt, so the clean-up costs about five cents a
year. Storage itself
is $0.0245 per GB-month ([cost.md](cost.md)).
