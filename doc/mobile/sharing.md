# Sharing into the app

Another app's **Share** offers TaskFest (#279): text, a link, an image or a PDF shared to it opens
**Add a task**, filled in, to be finished there — a due date chosen, at least. Android has it
(#355); iOS needs a share extension and follows (#356). Why `expo-sharing`, and why the app reads
only the raw share, is in [decisions/mobile-app.md](../decisions/mobile-app.md).

## What is offered

- **Android** offers TaskFest for text and links, and for images and PDFs: one, or several at
  once (`app.config.ts`). A file of another type is not offered TaskFest at all.

## What a share becomes

`mobile/src/incoming.ts` turns a share into a task to add:

- **Text and a link** are joined into the description, cut to the 255 characters the backend takes
  (`TaskCreateRequest`'s `maxLength`, which a test compares). A link stays text: nothing requests
  it.
- **Files** are copied into the app's cache, under `shared/`, and wait in the form as picked files
  do ([files.md](files.md)), to be attached once the task is added.
  - A file the backend would refuse is refused at once, by the website's rule and in its words —
    one the sending app says is too large without being copied first, and a type the backend
    takes is preferred to another spelling of it (`image/jpg` of a `photo.jpg`).
  - A file that cannot be described or copied — its permission withdrawn, a damaged photo — is
    said to be unreadable, and the rest of the share stays.
  - A task takes two: of more, the first two are kept, and the form says which were left out.
  - An iPhone's HEIC photo becomes a JPEG.
- **A file's name** is the end of its link. Where that says the type — `Rechnung.pdf` — it is kept;
  otherwise the file is named by its type, `shared.png`. Android's Files app shares links that end
  in a document's number, so its files arrive as `shared.png` and the like.

## When the form opens

`TaskFestApp` takes a share when the app starts and whenever it comes back to the foreground, and
opens the form once the board can take it:

- **Signed out**, it waits for the sign-in.
- **Over the board kept on the phone**, which takes no change ([board.md](board.md)), it waits
  until the current board is there.
- **Over a form, the account sheet or an open image**, it waits until they are closed, so nothing
  typed is lost.
- **Behind another share**: shares wait in turn, none replacing another. Each opens a form of its
  own, so nothing typed into the last one carries over.

The copies go once the form is closed — added, cancelled, or closed by a sign-out — and none of
its files is uploading any more; copies the form does not keep go at once; and copies a run left
behind go before the next run's first share.

## Tested

- `incoming.test.ts`: what a share becomes, names and refusals included.
- `TaskFestApp.sharing.test.tsx`: when the form opens, and when the copies go.
- Mobile CI's `board` share (`mobile/maestro/share/`): text sent to the app as another app sends
  it, and an image through the Files app's real share sheet, each added to the board.
