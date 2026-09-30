import { UndoToast } from 'frontend'

const noop = () => {}

/**
 * A stage that the toast can be fixed inside.
 *
 * The toast is `position: fixed`, centred on the bottom of the window -- right for a board
 * that fills the screen, and impossible for a card, where it escapes and leaves an empty
 * rectangle behind. A `transform` on an ancestor makes that ancestor the containing block for
 * fixed descendants, so the toast lands on the bottom of this stage instead. Nothing about the
 * component changes: it is the same rule, measured against a smaller box.
 */
function Stage({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'relative', height: 108, transform: 'translateZ(0)' }}>{children}</div>
}

export function OneTask() {
  return (
    <Stage>
      <UndoToast count={1} onUndo={noop} onDismiss={noop} />
    </Stage>
  )
}

/** Clearing a whole completed section offers one undo for all of it. */
export function SeveralTasks() {
  return (
    <Stage>
      <UndoToast count={4} onUndo={noop} onDismiss={noop} />
    </Stage>
  )
}
