# Privacy policy

*Deutsche Fassung: [Datenschutzerklärung](datenschutz.md)*

This policy covers TaskFest, the task list at `taskfest-qa.cloud.hilling.de` and `taskfest.cloud.hilling.de`
(“the application”), and this documentation site. It describes what the application actually
does, and changes in the same change as the behaviour it describes.

The application is a non-commercial demonstration project of Hilling IT GmbH. It is open to Google
accounts that have been invited to it; nobody else can sign in — except, in qa only, two test
accounts which automated tests sign in with. They belong to no person and hold only what those tests create and delete again.

## Who is responsible

Hilling IT GmbH — its address, managing director and register entry are in its
[imprint](https://www.hilling.it/impressum/).

Email: demo-apps[at]hilling.de (written this way against spam: replace `[at]` with `@`)

Write to that address for anything in this policy, including every request under “Your rights”
below.

## What is processed, why, and for how long

### Signing in with Google

You sign in with your Google account. With your consent on Google's own screen, Google tells the
application your **email address**, your **name**, the address of your **profile picture**, and
an identifier for your account.

- **Your email address** is stored, with the time your account was first created. It is what
  your tasks belong to.
- **Your name and picture** are used only to show you who you are signed in as. They are read
  from Google's sign-in token on each request and **are not stored**.

Legal basis: Art. 6(1)(b) GDPR, providing the application you asked to use. Kept until your
account is deleted.

### Your tasks

What you enter: each task's description, due date, importance and state, and when it was created
and last changed. Nobody but you can see your tasks in the application.

Legal basis: Art. 6(1)(b) GDPR. Kept until you delete them, or your account is deleted.

Please do not enter sensitive information (for example health data, or other people's personal
data) — this is a demonstration, and it is not built or operated for such data.

### Files you attach to tasks

What you attach: PDFs and images, at most 10 MB each, two per task and five in all, with their
names, types and sizes. The files are stored in Amazon S3 in AWS's Frankfurt region, encrypted;
their names, types and sizes are stored with your tasks. Your browser sends a file straight to
storage and fetches it from there, through links the application creates for you alone and which
stop working after a few minutes. Nobody but you can open your files in the application, and they
are never public.

Legal basis: Art. 6(1)(b) GDPR. Kept until you remove the file or delete its task, or your account
is deleted. A deleted task's files are kept for ten more minutes so that the deletion can be
undone, then deleted; a file whose upload never finished is deleted after an hour. Stored files
are not backed up: once deleted, a file is gone.

The same request applies to files as to tasks: please attach nothing sensitive.

### The session cookie

Signing in sets **one cookie**, which keeps you signed in and holds your encrypted sign-in tokens.
It is technically necessary for the application to work, which is why no consent banner is shown
(§ 25(2) no. 2 TDDDG). It ends when you sign out or your session expires.

There are **no** analytics, advertising or tracking cookies, and no analytics or tracking scripts
of any kind.

The language you choose in the footer is remembered by your browser, in its local storage; it is
not sent to the application.

### Technical logs

Every request passes through Amazon Web Services' content delivery network and load balancer, and
reaches the application's server. These record technical data such as the time, the requested
address, your IP address, your browser's identification, and whether the request succeeded. The
application's own log is kept for 30 days for `taskfest-qa` and 90 days for `taskfest`; network
logs are kept for 30 days.

Legal basis: Art. 6(1)(f) GDPR — the legitimate interest in running the application securely and
finding the cause of errors.

### Backups

The database is backed up automatically for 7 days while an environment is running. When an
environment is shut down, which happens often, a snapshot of its database is kept so that it can
be restored later. When you delete your account, the deletion is also applied to any backup or
snapshot that is restored afterwards, automatically, through the record described under *Your
rights*.

### Profile pictures

Your browser loads your profile picture directly from Google. Only if Google provides none does
the application look for a picture at **Gravatar** (Automattic Inc., USA); your browser then
loads it from Gravatar, which thereby learns your IP address and a hash of your email address.

## Who else receives data

- **Amazon Web Services** (Amazon Web Services EMEA SARL, Luxembourg) hosts the application, in
  its Frankfurt region. Its content delivery network serves requests from locations worldwide.
- **Google** (Google Ireland Ltd.) provides the sign-in.
- **Automattic** (Gravatar), as described above, only where Google provides no picture.
- **GitHub** (GitHub Inc., USA) hosts this documentation site and receives the technical data of
  visits to it.

These companies, or their parent companies, are in the USA. Transfers rely on the EU–US Data
Privacy Framework, under which they are certified, or on the EU's standard contractual clauses.

Nothing is sold, and nothing is used for advertising or for automated decisions about you.

## Your rights

You have the right to access the data held about you, to have it corrected or deleted, to
restrict its processing, to receive it in a machine-readable form, and to object to processing
based on legitimate interests (Art. 15–21 GDPR).

**To delete your account**, use *Delete account* at the top of the board. After a confirmation,
your account is deleted at once with everything it holds: your email address, all your tasks and
all your files. The one exception is a file that was still being uploaded at that moment: it can
arrive after the deletion, and is then deleted within seven days. You are then signed out, and a
session still open on another device no longer works. Signing in again later starts a new, empty
account. You can also write to the contact address above.

**What a deletion leaves behind:** a record that the account was deleted, so that the deletion
also applies to a database backup or snapshot restored later. The record holds a SHA-256 hash of
your email address and the time of the deletion, and nothing else; it is stored with the
attachments, in Amazon S3 in AWS's Frankfurt region. It does not contain your address, but it is
pseudonymous rather than anonymous: someone who already knows your address could compute the hash
and see that an account with it was deleted. It is deleted automatically once no backup or
snapshot of the database older than the deletion exists any more, since none could then bring the
account back. Legal basis: Art. 6(1)(c) GDPR in conjunction with
Art. 17 GDPR, the obligation to erase, which a restored backup would otherwise undo.

You also have the right to complain to a data protection supervisory authority (Art. 77 GDPR), for
example the one responsible for the operator:

Der Landesbeauftragte für den Datenschutz Niedersachsen<br>
Prinzenstraße 5<br>
30159 Hannover

## Changes

This policy is part of the project's documentation and is changed in the open, in the
repository. The date below is the date of the last change to its content.

Last changed: 8 October 2026
