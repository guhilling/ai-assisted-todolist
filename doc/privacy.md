# Privacy policy

*Deutsche Fassung: [Datenschutzerklärung](datenschutz.md)*

This policy covers TaskFest, the task list at `taskfest-qa.cloud.hilling.de` and `taskfest.cloud.hilling.de`
(“the application”), and this documentation site. It describes what the application actually
does, and changes in the same change as the behaviour it describes.

The application is a non-commercial demonstration project of Hilling IT GmbH. Anyone with a Google
account can sign in. `taskfest-qa.cloud.hilling.de` is its test environment, which may be changed
or reset at any time; there, two test accounts also sign in, which automated tests use. They
belong to no person and hold only what those tests create and delete again.

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
- **Your name and picture** are used only to show you who you are signed in as. They are taken
  from Google's sign-in token when you sign in and kept with your session, **never with your
  tasks**; they are deleted when the session ends, at the latest seven days after you signed in.

Legal basis: Art. 6(1)(b) GDPR, providing the application you asked to use. Kept until your
account is deleted.

### Your tasks

What you enter: each task's description, due date, due time and its time zone if you give one,
importance and state. Nobody but you can see your tasks in the application.

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

Signing in sets **one cookie**, which keeps you signed in. It holds only a random value that
names your session on the server; your sign-in tokens are not kept. The session itself — your
email address, name, picture address and your account's identifier at Google — is stored in the
application's database until it ends: when you sign out, after eight hours without use, and at
the latest seven days after you signed in. During sign-in itself a second cookie exists for at
most ten minutes, to check that Google's answer belongs to this sign-in. Both are technically
necessary for the application to work, which is why no consent banner is shown (§ 25(2) no. 2
TDDDG).

There are **no** analytics, advertising or tracking cookies, and no analytics or tracking scripts
of any kind.

The language you choose in the footer is remembered by your browser, in its local storage; it is
not sent to the application.

### Technical logs

Every request passes through Amazon Web Services' content delivery network and its API gateway,
and reaches the application. These record technical data such as the time, the requested
address, your IP address, your browser's identification, and whether the request succeeded. The
application's own log is kept for 30 days for `taskfest-qa` and 90 days for `taskfest`. For `taskfest-qa`, the application's log is also sent to a monitoring
server at Hetzner and kept there for 30 days as well; it holds your sign-in identifier, but neither
your IP address nor the content of your tasks.

Legal basis: Art. 6(1)(f) GDPR — the legitimate interest in running the application securely and
finding the cause of errors.

### Backups

For `taskfest`, the database can be restored to any moment of the past 35 days; `taskfest-qa` is
backed up only now and then, by hand. When you delete your account, the deletion is also applied
to any backup restored afterwards, automatically, through the record described under *Your
rights*. The database the application used until November 2026 was deleted on 15 November 2026,
with everything that was stored in it.

### Profile pictures

Your browser loads your profile picture directly from Google. Only if Google provides none does
the application look for a picture at **Gravatar** (Automattic Inc., USA); your browser then
loads it from Gravatar, which thereby learns your IP address and a hash of your email address.

### How the application uses Google user data

From Google the application receives only what is listed under *Signing in with Google*. It uses
it to sign you in, to keep your tasks yours, and to show you who you are signed in as; it shares
it with no one beyond the processors listed below, and stores and deletes it as this policy
describes. The application's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Who else receives data

- **Amazon Web Services** (Amazon Web Services EMEA SARL, Luxembourg) hosts the application, in
  its Frankfurt region. Its content delivery network serves requests from locations worldwide.
- **Hetzner** (Hetzner Online GmbH, Gunzenhausen, Germany) hosts the monitoring server that
  receives the application log of `taskfest-qa`, in Nuremberg.
- **Google** (Google Ireland Ltd.) provides the sign-in.
- **Automattic** (Gravatar), as described above, only where Google provides no picture.
- **GitHub** (GitHub Inc., USA) hosts this documentation site and receives the technical data of
  visits to it.

Apart from Hetzner, these companies, or their parent companies, are in the USA. Transfers rely on
the EU–US Data Privacy Framework, under which they are certified, or on the EU's standard
contractual clauses.

Nothing is sold, and nothing is used for advertising or for automated decisions about you.

## Your rights

You have the right to access the data held about you, to have it corrected or deleted, to
restrict its processing, to receive it in a machine-readable form, and to object to processing
based on legitimate interests (Art. 15–21 GDPR).

**To delete your account**, use *Account* → *Delete account* at the top of the board. After a
confirmation, your account is deleted at once with everything it holds: your email address, all your
tasks and all your files. The one exception is a file that was still being uploaded at that moment:
it can arrive after the deletion, and is then deleted within seven days. You are then signed out.
Signing in again later starts a new, empty account -- and so does using a session you left open on
another device, which cannot be ended from here. You can also write to the contact address above.

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

Last changed: 16 November 2026
