/**
 * Giving focus back to the control a popover or confirmation was opened from, once it has closed:
 * the calendar of a due date, the account deletion's confirmation.
 *
 * Done after the close is committed, never in the closing handler itself (#256): a component
 * inside the popover may still move focus while React removes it -- react-day-picker focuses its
 * selected day in an effect, and a day picked before that effect had run took the focus straight
 * back, then disappeared with the calendar, and focus fell to the page. A layout effect runs in the
 * same commit that removes the popover, before paint and before any other component's passive
 * effects, so focus never visibly rests on the page in between.
 */
import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Returns a function to call when closing in a way that should return focus -- a pick, Escape,
 * Cancel -- and not when closing by a click elsewhere, which has put focus where it wanted it.
 *
 * @param open whether the popover is open
 * @param trigger the control it was opened from, which takes focus once it has closed
 */
export function useReturnFocus(open: boolean, trigger: RefObject<HTMLElement | null>) {
  const pending = useRef(false)

  useLayoutEffect(() => {
    if (open) {
      // Opened again: whatever an earlier close asked for no longer applies.
      pending.current = false
    } else if (pending.current) {
      pending.current = false
      trigger.current?.focus()
    }
  }, [open, trigger])

  // The same function on every render, so an effect can depend on it.
  return useCallback(() => {
    pending.current = true
  }, [])
}
