# Files

A task's files in the app (#274), as on the website ([domain-model.md](../domain-model.md)): PDFs
and images. The app shows, opens and removes them; attaching one from the phone is still to come,
and is done on the website meanwhile.

## Seeing and opening them

- **On the board** each task's row shows its files under its description, as the website's does:
  an image as a 64-point preview — its thumbnail when it has one, the file itself otherwise, and the
  file again when the thumbnail cannot be had — and a PDF by its name.
- **Tapping one opens it.** An image opens in the app, over everything, as large as the screen
  allows, with **Close** to go back. A PDF opens in the phone's own viewer: on iOS the in-app
  browser shows it from its link; on Android it is downloaded into the app's cache and handed to
  whatever views PDFs there, which may read that one file (`mobile/src/documents.ts`). Without a
  PDF viewer, or without a connection, the board says the file could not be opened.
- **The links** are the backend's, signed for a few minutes (`api.ts`, `attachmentLink`), and only
  HTTPS ones are followed — or plain HTTP to the phone itself, the end-to-end stack's storage — as
  on the website. The app keeps each link while it works for another minute, so a preview asks once
  and not on every redraw of the board. Previews need a connection: the board kept on the phone
  ([board.md](board.md)) shows empty boxes instead.

## Removing them

The editor lists the task's files, each with **×** to remove it while the task is open; a completed
task's files may only be opened, as on the website. Removing is for good — unlike a task, a file has
no undo — and, like every change, is refused while the board shown is the one kept on the phone.
