# design-sync notes — ai-assisted-todolist

Repo-specific gotchas for future syncs. See `.design-sync/config.json` for the settings these
explain, and `conventions.md` for the README header the design agent is given.

## This repo is an application, not a component library

The sync works because a library build was added for it, not because one already existed:

- `frontend/src/design-system.ts` is the library entry; `npm run build:ds` produces
  `frontend/dist-ds/` (the ES bundle, the combined stylesheet, and the `.d.ts` tree).
  **Run it before the converter** — `cfg.buildCmd` records this.
- The app's own `frontend/dist/` is a bundled SPA and exports nothing. Never point the
  converter at it.
- `frontend` is `private: true` and stays unpublished. The `module`/`types`/`exports` keys
  exist only so a bundler can resolve the entry.

## Playwright came from the repo, not from an install

The render check needs chromium. `e2e/node_modules` already has playwright pinned to the same
chromium build as the local cache (1243), so `.ds-sync/node_modules/playwright*` are symlinks
into it. If a future sync fails with `Executable doesn't exist`, re-check that the e2e pin and
`~/Library/Caches/ms-playwright/` still agree before installing anything.

## Known render warns (triaged, expect these)

- **`[GRID_OVERFLOW]` on `UndoToast`** — the toast is `position: fixed`, so the checker flags it
  statically no matter what. The preview wraps it in a stage with a `transform`, which makes
  that stage the containing block, and the screenshots confirm both cells render inside their
  cards. The suggested `cardMode: single` remedy is deliberately *not* applied: it would hide
  one of two good cells to silence a warning that is already false.

## Preview decisions worth keeping

- **`AddTaskRow` has one story.** The row is collapsed until clicked, and `saving` is only
  visible once expanded — which a static card cannot reach. A second export rendered
  identically and tripped `[RENDER_THIN]`; dropping it was the honest fix.
- **`CompletedSection` is a `<details>` with no prop to open it.** The `Expanded` story sets
  the `open` attribute on mount via a ref, so the card shows the composition rather than a
  one-line summary. `Collapsed` shows the default.
- **`TaskRow` renders an `<li>`** and every story wraps it in `<ul className="task-list">`.
- **`UserAvatar`'s picture story uses a data URI.** The component falls back to initials when
  an image fails, so a real avatar URL would render the fallback offline and quietly claim to
  show the picture case.
- **Previews fix `today` and the due dates together.** The app's own fixtures compute dates
  from the real today on purpose (the board groups by distance); a preview wants both sides
  fixed so the words it prints never change.

## The sync cannot run in CI, and that is upstream

Checked rather than assumed, 2026-09-30:
[anthropics/claude-code#91063](https://github.com/anthropics/claude-code/issues/91063) — open,
no maintainer response, several teams asking for the same thing.

`/design-login` is the only way to obtain design-system authorization and it **requires an
interactive terminal**. Without a TTY the `DesignSync` tool is unavailable, so a GitHub Actions
runner, a scheduled job and an agent sandbox are all blocked.

Two consequences worth knowing before anyone tries again:

- **`@claude re-sync the design system` does not work either.** `claude.yml` runs on an Actions
  runner, which is exactly the blocked case. It looks like a workaround and is not one.
- **The read methods are blocked too**, not only the writes. That closes the obvious split of
  verifying in CI and uploading from a terminal: the headless half cannot read the project's
  `_ds_sync.json` anchor, so the converter loses its incremental scope and re-captures the whole
  library. The split pipeline costs more than the manual one.

The fix suggested upstream is for the `user:design:*` scopes to ride on the long-lived token
`claude setup-token` already mints, or to be provisionable as an environment secret. Neither
exists today. **Re-check that issue before attempting automation again** — if it closes, a
push-triggered sync becomes possible and the guards below already cover the inputs.

What *is* automated lives in the repository, from #86: the library entry is checked for
completeness by `design-system.test.ts`, `npm run build:ds` runs in Frontend CI, and
`npm run check:conventions` fails the build when this system's header names a token, class or
component that no longer exists.

## Re-sync risks

- **The library build can drift from the app.** `design-system.ts` re-exports by hand, so a new
  component under `frontend/src/components/` is invisible to the sync until it is added there.
  Nothing fails — the component is simply absent.
- **Preview dates are hardcoded to 2026-03-16.** They are internally consistent and will not
  rot, but they will look dated eventually; they are not tied to the real clock.
- **Grades live in `.design-sync/.cache/` and are gitignored.** Carry-forward across machines
  comes from the uploaded `_ds_sync.json`, not from git.
- **The conventions header enumerates real class and token names.** `npm run check:conventions`
  now fails the build when one stops resolving, so this is guarded rather than remembered — but
  it checks `dist-ds/frontend.css`, so it only means anything after `npm run build:ds`.
