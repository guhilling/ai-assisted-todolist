import { FileDrop } from 'frontend'

/**
 * Where files are dropped or chosen, with the limits said up front. Its other look, while a file
 * is dragged over it, exists only during a drag and cannot be shown on a card.
 */
export function Default() {
  return <FileDrop onFiles={() => {}} />
}
