import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../i18n/context'

type AccountDeletionProps = {
  /** The signed-in address, which has to be typed to confirm. */
  email: string
  /** Deletes the account and says whether it went; on success the board signs out. */
  onDelete: () => Promise<boolean>
}

/**
 * Deleting one's own account (#213): a quiet button in the header, and a confirmation that says
 * plainly what goes before anything happens.
 *
 * Unlike deleting a task, there is no undo afterwards, so the confirmation comes first and the
 * button that deletes says exactly that. It is an alert dialog in place rather than a modal: the
 * board stays readable behind it. The delete button stays disabled until the signed-in address is
 * typed (Gunnar), so two clicks in a row can never delete an account; the field takes the focus,
 * since typing is what comes next. Case and surrounding spaces do not matter -- they are not what
 * makes the address someone's own. Cancel and Escape close it, and focus goes back to the button
 * it was opened from.
 */
function AccountDeletion({ email, onDelete }: Readonly<AccountDeletionProps>) {
  const { messages } = useI18n()
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')
  const confirmed = typed.trim().toLowerCase() === email.trim().toLowerCase()
  const trigger = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)

  /**
   * Closing the confirmation puts focus back on the button it was opened from; without this it
   * falls to the page body when the dialog unmounts, and a keyboard user starts over at the top.
   */
  useEffect(() => {
    if (!asking && returnFocus.current) {
      returnFocus.current = false
      trigger.current?.focus()
    }
  }, [asking])

  const close = () => {
    returnFocus.current = true
    setTyped('')
    setAsking(false)
  }

  if (!asking) {
    return (
      <button type="button" className="account-delete" ref={trigger} onClick={() => setAsking(true)}>
        {messages.account.delete}
      </button>
    )
  }

  return (
    <section
      className="account-confirm"
      role="alertdialog"
      aria-labelledby="account-confirm-title"
      aria-describedby="account-confirm-body"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          close()
        }
      }}
    >
      <h2 id="account-confirm-title" className="account-confirm-title">
        {messages.account.title}
      </h2>
      <p id="account-confirm-body">{messages.account.body}</p>
      <label className="account-confirm-field">
        <span>{messages.account.typeEmail}</span>
        <input
          type="email"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </label>
      <div className="account-confirm-actions">
        <button type="button" className="button-quiet" onClick={close}>
          {messages.account.keep}
        </button>
        <button
          type="button"
          className="button-danger"
          disabled={deleting || !confirmed}
          onClick={() => {
            setDeleting(true)
            void onDelete().then((deleted) => {
              if (!deleted) {
                setDeleting(false)
                close()
              }
            })
          }}
        >
          {deleting ? messages.account.deleting : messages.account.confirm}
        </button>
      </div>
    </section>
  )
}

export default AccountDeletion
