/**
 * A popover opened from a button beside a field: the due date's calendar and the due time's list
 * (#588). It closes on a click outside the field, and on Escape anywhere in it -- the button
 * included -- giving the focus back to the button; Escape goes no further, since the forms treat it
 * as cancel, and one key press should not throw away a whole edit when it meant the popover.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react'
import { useReturnFocus } from './focus'

/**
 * @param field the field the popover belongs to, button and popover included
 * @param toggle the button that opens it, which takes the focus back
 */
export function usePopover(field: RefObject<HTMLElement | null>, toggle: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false)
  const returnFocus = useReturnFocus(open, toggle)

  /** Closes it, and has the button take the focus once it is gone. */
  const closeToButton = useCallback(() => {
    returnFocus()
    setOpen(false)
  }, [returnFocus])

  useEffect(() => {
    if (!open) {
      return
    }
    const closeUnlessInside = (event: MouseEvent) => {
      if (!field.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeToButton()
      }
    }
    document.addEventListener('click', closeUnlessInside)
    const element = field.current
    element?.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('click', closeUnlessInside)
      element?.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, field, closeToButton])

  return { open, setOpen, closeToButton }
}
