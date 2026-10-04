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
- **The loading-state test holds the board's own fetch open** rather than letting the stub
  resolve straight away. Loading is transient, and asserting it against an immediate stub is a
  race that passes on timing rather than on behaviour — it did, until it did not.

`dates.test.ts` covers the due-date logic directly rather than through the DOM. It is the only
pure logic in the frontend and the only place an off-by-one can hide: "Today", "Tomorrow", a
weekday name and a plain date are each one day apart. It includes a daylight-saving case,
because building a `Date` from `yyyy-mm-dd` at local midnight gets the answer wrong by a day
across a clock change — which is why every function there takes today as an argument and
anchors its arithmetic at UTC.

