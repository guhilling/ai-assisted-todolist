/**
 * Whether the board is used on a desktop (#588): anything but a touch screen, whose pickers suit
 * it, and where browsers' own date and time pickers differ, so TaskFest offers its own. The one
 * place that decides; the stylesheet follows it through a class, rather than asking for itself and
 * perhaps answering differently. Where the browser cannot say, as in jsdom, it counts as a phone.
 */
export function onDesktop() {
  return typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: coarse)').matches
}
