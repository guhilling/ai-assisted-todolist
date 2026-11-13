/**
 * Whether the board is used with a mouse or a trackpad (#588): a desktop, where browsers' own date
 * and time pickers differ, and TaskFest offers its own; on a phone, whose pickers suit it, the
 * phone's are used. Where the browser cannot say, as in jsdom, it counts as a phone.
 */
export function hasFinePointer() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches
}
