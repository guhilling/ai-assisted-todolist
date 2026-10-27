import { useEffect, useRef, useState } from 'react'
import { useEscapeWithin } from '../escape'
import { useReturnFocus } from '../focus'
import { useI18n } from '../i18n/context'
import AccountDeletion from './AccountDeletion'

type AccountMenuProps = {
  /** The signed-in address, which the dialog names and the deletion asks to be typed. */
  email: string
  /** Where signing out goes: the backend ends the session and comes back to the signed-out page. */
  logoutUrl: string
  /** Deletes the account and says whether it went; on success the board signs out. */
  onDelete: () => Promise<boolean>
}

/**
 * The header's **Account** (#385): a dialog with who is signed in, **Sign out** and **Delete
 * account**, as the app's account sheet has them.
 *
 * Neither is something to do with a single click, and the two took the header's room, so they wait
 * behind one button. The dialog opens in place under the header, as the deletion's confirmation
 * did, so the board stays readable behind it. Escape, a click outside it and Account itself close
 * it, and the focus goes back to Account -- except while the confirmation inside it is open: Escape
 * then closes only that, and a click outside does nothing, so a half-typed address is not lost.
 */
function AccountMenu({ email, logoutUrl, onDelete }: Readonly<AccountMenuProps>) {
  const { messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  // Closing puts focus back on Account; without this it falls to the page body when the dialog goes.
  const returnFocus = useReturnFocus(open, trigger)

  const close = () => {
    returnFocus()
    setOpen(false)
  }

  useEscapeWithin(panel, () => {
    if (!confirming) {
      close()
    }
  })

  useEffect(() => {
    if (!open || confirming) {
      return
    }
    const outside = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, confirming])

  return (
    <>
      <button
        type="button"
        className="account-open"
        ref={trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {messages.account.open}
      </button>
      {open ? (
        <section className="account-menu" role="dialog" aria-labelledby="account-menu-title" ref={panel}>
          <h2 id="account-menu-title" className="visually-hidden">
            {messages.account.open}
          </h2>
          <p className="account-menu-who">{messages.account.signedInAs(email)}</p>
          <div className="account-menu-actions">
            <a className="text-link" href={logoutUrl}>
              {messages.app.signOut}
            </a>
            <AccountDeletion email={email} onDelete={onDelete} onAsking={setConfirming} />
          </div>
        </section>
      ) : null}
    </>
  )
}

export default AccountMenu
