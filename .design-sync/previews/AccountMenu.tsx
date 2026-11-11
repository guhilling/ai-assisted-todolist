import { AccountMenu } from 'frontend'

const EMAIL = 'alex.morgan@example.com'
const deleteNothing = () => Promise.resolve(false)

/**
 * Clicks the given buttons in turn, each once it is there: the menu and the confirmation inside it
 * open only on a click, with no prop for either.
 */
function Clicked({ selectors, children }: { selectors: string[]; children: React.ReactNode }) {
  return (
    <div
      className="account-stage"
      ref={(node) => {
        if (!node || node.dataset.clicked) {
          return
        }
        node.dataset.clicked = 'yes'
        const next = (index: number) => {
          if (index === selectors.length) {
            return
          }
          const button = node.querySelector<HTMLButtonElement>(selectors[index])
          if (button) {
            button.click()
            requestAnimationFrame(() => next(index + 1))
          } else {
            requestAnimationFrame(() => next(index))
          }
        }
        next(0)
      }}
      // Room below for the popover; the transform keeps the narrow-screen fixed popover inside
      // the card as well.
      style={{ minHeight: 440, transform: 'translateZ(0)' }}
    >
      {/* The header row is the popover's containing block in the app; this one stands in for it. */}
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        {children}
      </div>
    </div>
  )
}

/** Account, at the right of the board's header, as every signed-in page shows it. */
export function Closed() {
  return (
    <Clicked selectors={[]}>
      <AccountMenu email={EMAIL} logoutUrl="#" onDelete={deleteNothing} />
    </Clicked>
  )
}

/** Open: who is signed in, signing out, and deleting the account. */
export function Open() {
  return (
    <Clicked selectors={['.account-open']}>
      <AccountMenu email={EMAIL} logoutUrl="#" onDelete={deleteNothing} />
    </Clicked>
  )
}

/** Deleting the account asks for the address to be typed before the red button works. */
export function ConfirmingDeletion() {
  return (
    <Clicked selectors={['.account-open', '.account-delete']}>
      <AccountMenu email={EMAIL} logoutUrl="#" onDelete={deleteNothing} />
    </Clicked>
  )
}
