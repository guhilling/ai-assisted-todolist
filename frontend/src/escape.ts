/**
 * Escape, while focus is inside an element: how the add row, the editor and the account
 * confirmation close themselves.
 *
 * Listening on the document rather than on the element itself keeps a keyboard handler off a
 * non-interactive element -- a form, a section -- which screen readers do not expect one on
 * (Sonar's S6847), and the containment check keeps the old reach: Escape closes only the thing
 * focus is in, so a row menu's own Escape elsewhere on the page is left alone.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Calls `onEscape` when Escape is pressed while focus is inside `ref`'s element.
 *
 * It calls the handler the element was last drawn with from the moment it is drawn (#364): the
 * handler is kept in a ref that a layout effect updates, which runs as the element is drawn. An
 * effect runs a moment later, and an Escape in between called the handler from before -- the add
 * row closed while its files went up, which it is locked against. The listener itself is added
 * once, not again with every render's new handler.
 */
export function useEscapeWithin(ref: RefObject<HTMLElement | null>, onEscape: () => void) {
  const handler = useRef(onEscape)
  useLayoutEffect(() => {
    handler.current = onEscape
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target instanceof Node && ref.current?.contains(event.target)) {
        handler.current()
      }
    }
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [ref])
}
