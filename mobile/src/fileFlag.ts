import type { TextFile } from './keptBoard'

/**
 * A question answered once on this phone, remembered by a file existing (#335): the board's
 * colours explained and dismissed. Nothing to read back -- the file being there is the answer.
 *
 * @param file where it is kept, in the app's documents so a cleared cache does not ask again
 * @param value what the file says, for whoever looks
 */
export function fileFlag(file: TextFile, value: string) {
  return {
    seen: async () => file.exists,
    dismiss: async () => file.write(value),
  }
}
