/**
 * Escape, while focus is inside an element: how the add row, the editor and the account
 * confirmation close themselves.
 *
 * Listening on the document rather than on the element itself keeps a keyboard handler off a
 * non-interactive element -- a form, a section -- which screen readers do not expect one on
 * (Sonar's S6847), and the containment check keeps the old reach: Escape closes only the thing
 * focus is in, so a row menu's own Escape elsewhere on the page is left alone.
 */
import { useLayoutEffect, type RefObject } from 'react'

export function useEscapeWithin(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  // A layout effect, not an effect: it listens with the handler the element was drawn with as
  // soon as it is drawn. An effect comes a moment later, and an Escape in between called the
  // handler before -- the add row closed while its files went up, which it is locked against (#364).
  useLayoutEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Node && ref.current?.contains(event.target)) {
        onEscape()
      }
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [ref, onEscape])
}
