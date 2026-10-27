import { useEffect, useRef, useState } from 'react'
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
 * did, so the board stays readable behind it, and takes the focus. Escape, a click outside it,
 * Account itself and the focus leaving it close it, the focus going back to Account where it was
 * in the dialog. While the confirmation inside it is open, Escape there closes only that, and
 * neither a click outside nor Account closes the dialog, so a half-typed address is not lost.
 */
function AccountMenu({ email, logoutUrl, onDelete }: Readonly<AccountMenuProps>) {
  const { messages } = useI18n()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLElement>(null)
  const signOut = useRef<HTMLAnchorElement>(null)
  // Closing puts focus back on Account; without this it falls to the page body when the dialog goes.
  const returnFocus = useReturnFocus(open, trigger)

  const close = () => {
    returnFocus()
    setOpen(false)
  }

  useEffect(() => {
    if (open) {
      signOut.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const within = (target: EventTarget | null) =>
      target instanceof Node && (panel.current?.contains(target) || trigger.current?.contains(target))
    // Escape inside the confirmation is the confirmation's own; anywhere else in the dialog, or on
    // Account, it closes the dialog, confirmation and all.
    const escape = (event: KeyboardEvent) => {
      const target = event.target
      if (event.key !== 'Escape' || !within(target)) {
        return
      }
      if (target instanceof Element && target.closest('[role="alertdialog"]')) {
        return
      }
      close()
    }
    const outside = (event: Event) => {
      if (!confirming && !within(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', escape)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      document.removeEventListener('keydown', escape)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
    }
  })

  return (
    <>
      <button
        type="button"
        className="account-open text-link"
        ref={trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (!open) {
            setOpen(true)
          } else if (!confirming) {
            close()
          }
        }}
      >
        {messages.account.open}
      </button>
      {open ? (
        <section className="account-menu header-popover" role="dialog" aria-labelledby="account-menu-title" ref={panel}>
          <h2 id="account-menu-title" className="visually-hidden">
            {messages.account.open}
          </h2>
          <p className="account-menu-who">{messages.account.signedInAs(email)}</p>
          <div className="account-menu-actions">
            <a className="text-link" href={logoutUrl} ref={signOut}>
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
