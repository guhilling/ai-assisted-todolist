import { AccountDeletion } from 'frontend'

const EMAIL = 'alex.morgan@example.com'
const deleteNothing = () => Promise.resolve(false)
const noop = () => {}

/** The button, as it sits in the account menu's actions. */
export function Default() {
  return <AccountDeletion email={EMAIL} onDelete={deleteNothing} onAsking={noop} />
}

/**
 * The confirmation, inline as in the account menu (`onAsking` given). It opens only on a click,
 * so this clicks the button once on mount.
 */
export function Asking() {
  return (
    <div
      className="account-menu-actions"
      ref={(node) => node?.querySelector<HTMLButtonElement>('.account-delete')?.click()}
    >
      <AccountDeletion email={EMAIL} onDelete={deleteNothing} onAsking={noop} />
    </div>
  )
}
