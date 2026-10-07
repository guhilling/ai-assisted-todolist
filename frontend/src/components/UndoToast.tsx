import { useEffect } from 'react'
import { useI18n } from '../i18n/context'

/** How long the offer stands. Long enough to notice, short enough not to sit in the way. */
const DISMISS_AFTER_MS = 8000

type UndoToastProps = {
  count: number
  onUndo: () => void
  onDismiss: () => void
}

/**
 * The offer to put back what was just deleted.
 *
 * It exists instead of a confirmation dialog: deleting is one click and is reversible for a
 * few seconds, which is both quicker and safer than being asked "are you sure?" every time
 * and learning to click through it.
 *
 * `onDismiss` has to be referentially stable, or every render of the board would restart the
 * countdown.
 */
function UndoToast({ count, onUndo, onDismiss }: Readonly<UndoToastProps>) {
  const { messages } = useI18n()
  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_AFTER_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span>{messages.undo.deleted(count)}</span>
      <button type="button" className="undo-action" onClick={onUndo}>
        {messages.undo.undo}
      </button>
      <button type="button" className="undo-dismiss" aria-label={messages.undo.dismiss} onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}

export default UndoToast
