# Files

A task's files in the app (#274), as on the website ([domain-model.md](../domain-model.md)): PDFs
and images, attached from the phone's camera, photo library or files, shown on the board, opened,
and removed.

## Attaching them

- **In the editor** of an open task: **Take a photo**, **Choose a photo** or **Choose a file**, with
  the website's limits below — a PDF or an image, up to 10 MB, two per task and five in all
  (`frontend/src/attachmentPolicy.ts`, which both use). A task that holds two offers no more and
  says why; a completed task offers none, as on the website.
- **While adding a task**, as the website's add row does: the files picked are listed with **×** to
  let one go again, and attached once the task exists. One that cannot be attached then leaves the
  task as it is, and the board says which file and why.
- **Refused on the phone first.** A file the backend would refuse — another type, empty, too
  large — is refused before anything is sent, by the website's own rule and in its words; the
  backend's own refusals (`TASK_FULL`, `USER_FULL`, `MISMATCH`) are worded the same way.
- **The upload is the website's** (`mobile/src/upload.ts`): announced, put straight to storage
  through the signed link with exactly the headers it was signed for, and confirmed; the content
  never passes through the backend. The editor says how far it has got, and saving or deleting the
  task waits for it; a file that fails after the editor was closed is said on the board instead.
- **A photo brings its thumbnail**, made on the phone by the website's rule
  (`frontend/src/thumbnail.ts`: 128 on the short side, a panorama's middle, a JPEG at 0.8, at most
  64 KB) and uploaded beside it (`mobile/src/thumbnails.ts`, expo-image-manipulator). Only a JPEG
  larger than 64 KB gets one: the website draws a PNG's transparency on white, which the
  manipulator cannot, so a PNG shows the file itself. A thumbnail that cannot be made leaves the
  file as it would have been without.
- **An iPhone's HEIC photo becomes a JPEG**: the library is asked for a compatible one, and any HEIC
  left is converted (`mobile/src/pick.ts`), since the backend takes JPEG, PNG, WebP, GIF and PDF.
- **Permissions**: iOS asks for the camera and the photo library with the texts in
  `app.config.ts`; Android's photo picker and file picker need none, and the camera is asked for
  when first used. A camera the user refused is said so, with where to allow it.

## Seeing and opening them

- **On the board** each task's row shows its files below it, as the website's does: an image as a
  64-point preview — its thumbnail when it has one, the file itself otherwise, and the file again
  when the thumbnail cannot be had — and a PDF by its name. They stand below the row's button rather
  inside it, so a screen reader reaches each one.
- **Tapping one opens it.** An image opens in the app, over everything, as large as the screen
  allows, with **Close** to go back. A PDF opens in the phone's own viewer: on iOS the in-app
  browser shows it from its link; on Android it is downloaded into the app's cache and handed, by
  its own type, to whatever views that there, which may read that one file
  (`mobile/src/documents.ts`). Without a viewer, or without a connection, the board says the file
  could not be opened — and nothing more: a file that could not be had is no change gone wrong, so
  the board is not reloaded for it, nor when the user comes back from the viewer, as it is when
  they come back to the app from anywhere else. One file opens at a time, and none once the user has moved on to
  a form or the account sheet.
- **The links** are the backend's, signed for an hour (`download-link-lifetime`), and must pass the
  website's own rule for links to storage (`frontend/src/storage.ts`): HTTPS, or plain HTTP to the
  phone itself, the end-to-end stack's storage. The app uses each link again for five minutes, by the
  phone's clock alone, so a preview asks once and not on every redraw, and two asking at once share
  one request. Previews need a connection: the board kept on the phone ([board.md](board.md)) shows
  empty boxes instead.
- **Signing out forgets them**: the image open, the links, and the copies Android downloaded.

## Removing them

The editor lists the task's files, each with **×** to remove it while the task is open; a completed
task's are not removable, as on the website. They open from the board, not from the editor: a viewer
over the editor's sheet is more than iOS presents. Removing is for good — unlike a task, a file has
no undo — waits for any change to the task already on its way, and, like every change, is refused
while the board shown is the one kept on the phone; the editor says so.
