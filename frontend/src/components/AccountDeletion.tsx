import { useState } from 'react'
import { useI18n } from '../i18n/context'

type AccountDeletionProps = {
  /** Deletes the account and says whether it went; on success the board signs out. */
  onDelete: () => Promise<boolean>
}

/**
 * Deleting one's own account (#213): a quiet button in the header, and a confirmation that says
 * plainly what goes before anything happens.
 *
 * Unlike deleting a task, there is no undo afterwards, so the confirmation comes first and the
 * button that deletes says exactly that. It is an alert dialog in place rather than a modal: the
 * board stays readable behind it, and Cancel is the first button, which is where focus lands.
 */
function AccountDeletion({ onDelete }: Readonly<AccountDeletionProps>) {
  const { messages } = useI18n()
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!asking) {
    return (
      <button type="button" className="account-delete" onClick={() => setAsking(true)}>
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
    >
      <h2 id="account-confirm-title" className="account-confirm-title">
        {messages.account.title}
      </h2>
      <p id="account-confirm-body">{messages.account.body}</p>
      <div className="account-confirm-actions">
        <button type="button" className="button-quiet" autoFocus onClick={() => setAsking(false)}>
          {messages.account.keep}
        </button>
        <button
          type="button"
          className="button-danger"
          disabled={deleting}
          onClick={() => {
            setDeleting(true)
            void onDelete().then((deleted) => {
              if (!deleted) {
                setDeleting(false)
                setAsking(false)
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
