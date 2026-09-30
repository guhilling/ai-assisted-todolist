# Building with the task board

These components come from `ai-assisted-todolist` — a small board for tasks that have a due
date, an importance and a workflow state. They are application components, not a neutral UI
kit: a `TaskRow` renders a task, not an arbitrary list item. Build task-board screens with
them, and use the tokens and classes below for everything around them.

## Setup: none

There is no provider and no theme wrapper. The tokens are defined on `:root` in the stylesheet,
and a `prefers-color-scheme: dark` block redefines them there too — so linking `styles.css` is
the whole setup, and dark mode already works. Do not add a theme context; there isn't one.

`.app` is the board's page wrapper (centred column, padding). Use it for a full board screen.

## The styling idiom: hand-written classes plus `var(--token)`

Plain CSS classes, BEM-ish: a block (`.task-row`) and a `--` modifier (`.task-row--done`).
There are no utility classes — no `p-4`, no `flex`, no `bg-surface`. For your own layout glue,
write CSS using the tokens rather than inventing colour values, spacing or type sizes.

**Tokens** (all of them; each flips automatically in dark mode):

| | |
|---|---|
| Surfaces | `--bg`, `--surface`, `--surface-raised`, `--border`, `--radius` |
| Text | `--text`, `--text-muted` |
| Accent | `--accent`, `--accent-contrast` |
| Status | `--danger`, `--importance-low`, `--importance-medium`, `--importance-high` |
| Spacing | `--space-1` `--space-2` `--space-3` `--space-4` `--space-6` `--space-8` `--space-12` `--space-16` |
| Type | `--font-display`, `--font-title`, `--font-body`, `--font-small` |

**Spacing is a strict 4px grid** and the number is the step count, so `--space-4` is 16px and
`--space-6` is 24px. Every padding, margin and gap in this system comes from it. Use it for
your own layout too — do not write a raw pixel value, and do not invent a step between two of
these.

**There are four type sizes and nothing between them.** 2rem, 1.5rem, 1rem, 0.875rem. If a
piece of text needs its own size, it wants one of these four instead.

**Class families** (the real names — use these, don't invent):

- Shell: `.app`, `.app-header`, `.app-title`, `.app-identity`, `.app-email`, `.app-footer`
- Board: `.task-section`, `.section-title`, `.section-title--overdue`, `.task-list`,
  `.task-row`, `.task-row--done`, `.task-body`, `.task-check`, `.task-description`,
  `.task-meta`, `.task-chip`, `.task-importance` (+ `--low` / `--medium` / `--high`),
  `.task-due--overdue`, `.task-menu`, `.task-menu-items`, `.task-menu-danger`
- Add row: `.add-row`, `.add-row-plus`, `.add-row-key`, `.add-form`, `.add-field`,
  `.add-description`, `.add-controls`, `.add-actions`, `.quick-dates`
- Controls: `.button-primary`, `.button-quiet`, `.text-link`, `.chip`, `.chip--active`
- Signed out: `.signed-out`, `.signed-out-title`, `.signed-out-copy`, `.signed-out-actions`,
  `.signed-out-note`
- Other: `.completed-section`, `.completed-actions`, `.undo-toast`, `.undo-action`,
  `.undo-dismiss`, `.user-avatar`, `.user-avatar--initials`, `.error-banner`, `.board-note`,
  `.visually-hidden`

## Three things that will bite you

- **`TaskRow` renders an `<li>`.** Put it inside `<ul className="task-list">`, or use
  `TaskSection`, which does that for you.
- **`UndoToast` is `position: fixed`**, centred on the bottom of the window. It is not a
  flow element; don't try to place it in a layout.
- **`CompletedSection` is a `<details>`**, closed by default, with no prop to open it.

## Where the truth is

Read `styles.css` and the `_ds_bundle.css` it imports for the real rules — every class above is
defined there. Each component's `.prompt.md` carries its props and usage.

## An idiomatic screen

```jsx
<main className="app">
  <header className="app-header">
    <h1 className="app-title">Tasks</h1>
    <div className="app-identity">
      <UserAvatar email="alice@example.com" name="Alice Example" />
    </div>
  </header>

  <AddTaskRow today="2026-03-16" saving={false} onAdd={async () => true} />

  <TaskSection
    title="Overdue"
    overdue
    today="2026-03-16"
    tasks={overdueTasks}
    onToggleDone={toggle}
    onSetState={setState}
    onDelete={remove}
  />

  <p
    className="board-note"
    style={{ color: 'var(--text-muted)', fontSize: 'var(--font-small)', marginTop: 'var(--space-6)' }}
  >
    Nothing else due this week.
  </p>
</main>
```

A task is `{ id, description, dueDate: 'YYYY-MM-DD', importance: 'LOW' | 'MEDIUM' | 'HIGH',
state: 'TODO' | 'WORKING' | 'DONE' }`, and `today` is always passed in as an ISO date rather
than read from the clock.
