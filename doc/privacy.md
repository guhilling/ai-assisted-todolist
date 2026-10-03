# Privacy policy

This policy covers the task list at `todolist-qa.cloud.hilling.de` and `todolist.cloud.hilling.de`
(“the application”), and this documentation site. It describes what the application actually
does, and changes in the same change as the behaviour it describes.

The application is a private, non-commercial demonstration project. It is open to Google accounts
that have been invited to it; nobody else can sign in.

## Who is responsible

Gunnar Hilling
‹postal address›
‹contact email›

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

### The session cookie

Signing in sets **one cookie**, which keeps you signed in and holds your encrypted sign-in tokens.
It is technically necessary for the application to work, which is why no consent banner is shown
(§ 25(2) no. 2 TDDDG). It ends when you sign out or your session expires.

There are **no** analytics, advertising or tracking cookies, and no analytics or tracking scripts
of any kind.

### Technical logs

Every request passes through Amazon Web Services' content delivery network and load balancer, and
reaches the application's server. These record technical data such as the time, the requested
address, your IP address, your browser's identification, and whether the request succeeded. The
application's own log is kept for 30 days for `todolist-qa` and 90 days for `todolist`; network
logs are kept for 30 days.

Legal basis: Art. 6(1)(f) GDPR — the legitimate interest in running the application securely and
finding the cause of errors.

### Backups

The database is backed up automatically for 7 days while an environment is running. When an
environment is shut down, which happens often, a snapshot of its database is kept so that it can
be restored later. A deletion you ask for is also applied to any snapshot that is restored
afterwards.

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

**To delete your account**, write to the contact address above. The application has no
self-service deletion yet; your email address and all your tasks are then deleted.

You also have the right to complain to a data protection supervisory authority, for example
‹the supervisory authority for the controller's federal state›.

## Changes

This policy is part of the project's documentation and is changed in the open, in the
repository. The date below is the date of the last change to its content.

Last changed: ‹date of publication›
