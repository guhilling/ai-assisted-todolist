# Sharing into the app

Another app's **Share** offers TaskFest (#279): text, a link, an image or a PDF shared to it opens
**Add a task**, filled in, to be finished there — a due date chosen, at least. Android has it
(#355), and iOS through a share extension (#356). Why `expo-sharing`, and why the app reads only
the raw share, is in [decisions/mobile-app.md](../decisions/mobile-app.md).

## What is offered

- **Android** offers TaskFest for text and links, and for images and PDFs: one, or several at
  once (`app.config.ts`). A file of another type is not offered TaskFest at all.
- **iOS** offers it the same way, through a **share extension**: a small second app inside
  TaskFest that `expo-sharing`'s plugin generates. Its rule says which shares it is offered for,
  by type (`mobile/src/shareExtension.ts`): those whose every item is an image, a PDF, a link or
  text — a link or text that is not a file, so a `.txt` from the Files app is not offered. (Android
  offers it, as text, and the form then says the file's type is not taken.)
- **Android's share sheet says what it does**: *Create Task* — *Create Task (QA)* and *Create
  Task (Dev)* in the other builds, so that two installed side by side can be told apart
  (`mobile/src/variants.ts`). It is the label of the shares the app is offered for
  (`mobile/plugins/withShareLabel.ts`), which the share sheet shows beneath the app's name, as it
  shows Maps' *Add to …*.
- **iOS's share sheet shows the app**: TaskFest's icon and name — *TaskFest*, *TaskFest QA*,
  *TaskFest Dev* — in the row of apps, not the extension's own name: iOS 26 names every share
  extension there by its app. It is the row of icons, not the **Actions** list beneath it:
  that list is for action extensions, a different kind, which TaskFest does not have. A newly
  installed app may sit at the end of the row, or behind **More**. The extension is still called
  *Create Task* (`mobile/plugins/withShareExtensionName.ts`), where the plugin would call it
  "expo-sharing-extension", in case another iOS version or screen shows it.

## How a share reaches the app

- **On Android** the share starts the app, or reaches it running, as an intent; files come as
  links the app may read for as long as it runs, and are copied at once.
- **On iOS** the extension runs on its own, in the sending app's share sheet. It copies the files
  into an **App Group** — a folder TaskFest and its extension share, `group.<bundle id>` — each
  into a folder of its own, so two files of one name both arrive (`expo-sharing`'s extension would
  copy them side by side, under their names; `mobile/plugins/withShareExtensionName.ts` changes
  that) — notes the share there, and opens TaskFest by its URL scheme. Apple offers an extension no public way
  to open its app; the one used here is the one every such library uses, and App Review may object
  to it. If it does, the fallback is an extension of the project's own, not built yet, that keeps
  the share and says *"Saved. Open TaskFest to finish it."*: the app's side would stay the same,
  since it looks for a share whenever it becomes active
  ([decisions/mobile-app.md](../decisions/mobile-app.md)).
- The App Group must be known to Apple, for the app and the extension, and both must be signed
  with it: [distribution.md](distribution.md) has the steps, and the check that a release keeps it.

## What a share becomes

`mobile/src/incoming.ts` turns a share into a task to add:

- **Text and a link** are joined into the description, cut to the 255 characters the backend takes
  (`TaskCreateRequest`'s `maxLength`, which a test compares). A link stays text: nothing requests
  it.
- **Files** are copied into the app's cache, under `shared/`, and go up as soon as the form opens,
  to its draft, as picked files do ([files.md](files.md)): by the time the form is filled in, they
  are there, and Add only adds the task (#381).
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
behind go before the next run's first share. On iOS the extension's own copies, in the App Group,
go as soon as the app has read them, with their folders (`releaseShared` in `Main.tsx`).

## Tested

- `incoming.test.ts`: what a share becomes, names and refusals included.
- `TaskFestApp.sharing.test.tsx`: when the form opens, and when the copies go.
- Mobile CI's `board` share (`mobile/maestro/share/`): text sent to the app as another app sends
  it, and an image through the Files app's real share sheet, each added to the board.
- Mobile CI's iOS build: the extension's name, its App Group, its rule evaluated against shares
  of each kind, and both signed with the App Group as a release signs them
  (`.github/scripts/check-share-extension.py`, `check-share-activation.swift`,
  `sign-with-app-group.sh`).
- Mobile CI's iOS share (`mobile/maestro/ios/`, #380): that signed build on an iPhone simulator, a
  photo shared from Photos through the real share sheet, where *TaskFest Dev* must be offered and
  must open the app; the simulator's iOS asks first, and the flow lets it. No stack runs on the
  macOS runner, so it ends at the sign-in: whether the photo was kept is not checked there, and
  the way on to the board is the Android flows'. Its screenshots, Maestro's debug output and the
  simulator's log for the share are the `maestro-output-ios` artifact. **It does not fail Mobile CI
  for now** (#401): it failed often enough that a red run said nothing, so a failure is a warning
  on the run until it is reliable. The failures were the simulator's, before any of TaskFest's
  code: Photos now and then never finishes preparing the photo, so iOS never starts the extension,
  and a tap on *Open* while iOS's question was still coming in went nowhere. The flow shares the
  photo again, once, from a restarted Photos when nothing has happened after 90 s, and taps *Open*
  again while the question is still there. Once `main` has passed it ten times in a row, it fails
  the run again. Still tried by hand, on TestFlight: a link or text shared on an iPhone, and a share
  taken on to the board signed in.
