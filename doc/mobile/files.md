# Files

A task's files in the app (#274), as on the website ([domain-model.md](../domain-model.md)): PDFs
and images. The app shows, opens and removes them; attaching one from the phone is still to come,
and is done on the website meanwhile.

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
  the board is not reloaded for it. One file opens at a time, and none once the user has moved on to
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
