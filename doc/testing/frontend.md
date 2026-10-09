# Frontend

```bash
cd frontend
npm run test            # Vitest
npm run test:coverage   # with the lcov report SonarCloud consumes
npm run lint            # oxlint
npm run build           # tsc -b && vite build
```

`App.test.tsx` renders the board against a stubbed `fetch` and checks what the user sees and
does in each state: signed out, signed in, adding, completing, deleting, clearing, and each
way the backend can refuse. `mockApi` routes on the method as well as the path, because list,
create, update and delete all share the `/api/tasks` URL and only the method tells them apart.

Two details are deliberate:

- **Fixture dates are computed from the real today**, not hardcoded. The board reads the clock
  once on mount and groups rows by how far away they are, so a fixed date would change which
  section a row lands in as time passed, and the suite would rot quietly.
- **A race that CI hits now and then gets a test that hits it every time.** The calendar's focus
  test failed on slow runners only (#256): react-day-picker focuses the selected day in an effect,
  and a day picked before that effect had run lost the focus the field had just given back.
  `DueDateFocus.test.tsx` makes the late focus happen deterministically -- it failed with the CI
  error before the fix -- rather than retrying the original until it passes.
- **The loading-state test holds the board's own fetch open** rather than letting the stub
  resolve straight away. Loading is transient, and asserting it against an immediate stub is a
  race that passes on timing rather than on behaviour — it did, until it did not.

`AttachWhileAdding.test.tsx` covers attaching in the add row (#216): files held until Add,
refused at once by type or count, uploaded once the task exists, and a refusal after it that
leaves the task in place. `Attachments.test.tsx` and `attachments-api.test.ts` cover files on tasks (#204): the row's list,
preview, open and remove, and the editor's choose, drop, progress and refusals; and underneath,
announce, upload and confirm. The upload goes through `XMLHttpRequest`, the only browser API that
reports upload progress, so both stub it next to `fetch`. Opening a file is asserted to open the
tab *on the click* and point it at the link afterwards, because a tab opened once a request has
come back is what popup blockers block. `ThumbnailPreview.test.tsx` covers the row's thumbnail and
its fallback to the file (#236), `thumbnail.test.ts` the thumbnail's size and making one against a
stubbed canvas -- jsdom has none -- and the end of `attachments-api.test.ts` the second upload.

`dates.test.ts` covers the due-date logic directly rather than through the DOM. It is the only
pure logic in the frontend and the only place an off-by-one can hide: "Today", "Tomorrow", a
weekday name and a plain date are each one day apart. It includes a daylight-saving case,
because building a `Date` from `yyyy-mm-dd` at local midnight gets the answer wrong by a day
across a clock change — which is why every function there takes today as an argument and
anchors its arithmetic at UTC.

