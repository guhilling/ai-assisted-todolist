import type { Attachment } from './web'

/**
 * The previews kept on the phone (#397), so the board kept for reading offline (#272) shows its
 * files' previews too: each one the board has shown -- an image's thumbnail, or the image itself
 * when it has none -- under its attachment's id and which of the two it is. An attachment never
 * changes, so that is all a kept preview needs to stay right; one whose attachment has left the
 * board goes when the board is next kept, and all of them go with the session.
 *
 * What is kept is whatever the board shows as a preview, not an image as such, so a preview of
 * another kind can be kept here when there is one.
 */

/** Keeps, finds and forgets the previews. */
export type PreviewStore = {
  /** Where the kept preview of an attachment is -- its thumbnail, or the file itself -- or null when none is kept. */
  find(attachmentId: Attachment['id'], thumbnail: boolean): Promise<string | null>
  /**
   * Downloads a preview from its link and keeps it, saying where; rejects, keeping nothing, when it
   * cannot -- or when the previews were forgotten, or its attachment left the board, meanwhile.
   */
  keep(attachmentId: Attachment['id'], thumbnail: boolean, url: string): Promise<string>
  /** Forgets every kept preview but those of these attachments. */
  retain(attachmentIds: Iterable<Attachment['id']>): Promise<void>
  /** Forgets them all, and any on its way. */
  clear(): Promise<void>
}

/** The folder the previews are kept in, by name: what this needs of expo-file-system, so tests keep it in memory. */
export type PreviewFolder = {
  /** Where the named file is, or null when there is none. */
  find(name: string): string | null
  /** Downloads a link into the named file; rejects on any failure, maybe leaving part of it. */
  download(url: string, name: string): Promise<void>
  /** Renames a file, replacing any of the new name, and says where it now is. */
  move(from: string, to: string): string
  names(): string[]
  remove(name: string): void
  clear(): void
}

/** A preview's file: the attachment's id, and `-file` when it is the file itself rather than its thumbnail. */
function nameOf(attachmentId: Attachment['id'], thumbnail: boolean): string {
  return thumbnail ? String(attachmentId) : `${attachmentId}-file`
}

/** The attachment a file in the folder belongs to, whatever it is: a kept preview or a download on its way. */
function attachmentOf(name: string): string {
  return name.split(/[-.]/)[0]
}

/** A thing that went away while its preview was downloading. */
class NoLongerWantedError extends Error {
  constructor() {
    super('The preview is no longer wanted.')
    this.name = 'NoLongerWantedError'
  }
}

/**
 * Previews kept in a folder of their own, one file per preview. A download lands under a name of
 * its own first and is moved into place only once it is whole, so neither a cut-short one nor two
 * at once can be taken for a preview; two asks for the same preview share one download.
 */
export function createPreviewStore(folder: PreviewFolder): PreviewStore {
  const downloading = new Map<string, Promise<string>>()
  /** Which download this is, so each lands under a name of its own. */
  let downloads = 0
  /** Counted up by every `clear`: a download begun before one is not kept. */
  let clears = 0
  /** Counted up by every `retain`, with the attachments the last one kept. */
  let retains = 0
  let retained = new Set<string>()

  const download = async (name: string, url: string): Promise<string> => {
    const [clearsBefore, retainsBefore] = [clears, retains]
    const part = `${name}.${(downloads += 1)}.part`
    try {
      await folder.download(url, part)
      const forgotten = clears !== clearsBefore
      const leftTheBoard = retains !== retainsBefore && !retained.has(attachmentOf(name))
      if (forgotten || leftTheBoard) {
        throw new NoLongerWantedError()
      }
      return folder.move(part, name)
    } catch (failure) {
      folder.remove(part)
      throw failure
    }
  }

  return {
    async find(attachmentId, thumbnail) {
      return folder.find(nameOf(attachmentId, thumbnail))
    },

    keep(attachmentId, thumbnail, url) {
      const name = nameOf(attachmentId, thumbnail)
      const known = downloading.get(name)
      if (known) {
        return known
      }
      const kept = download(name, url).finally(() => downloading.delete(name))
      downloading.set(name, kept)
      return kept
    },

    async retain(attachmentIds) {
      retains += 1
      retained = new Set([...attachmentIds].map(String))
      const onTheirWay = new Set(downloading.keys())
      // Anything else in the folder goes too -- part of a download a run left behind, say -- but
      // not a download on its way: it is checked against the board once it has arrived.
      folder
        .names()
        .filter((each) => !retained.has(attachmentOf(each)) || (each.endsWith('.part') && !onTheirWay.has(each.replace(/\.\d+\.part$/, ''))))
        .forEach((each) => folder.remove(each))
    },

    async clear() {
      clears += 1
      folder.clear()
    },
  }
}

/** No previews kept: each is shown from its link, every time. For an app given no store. */
export const noPreviews: PreviewStore = {
  find: async () => null,
  keep: async () => {
    throw new Error('No previews are kept.')
  },
  retain: async () => undefined,
  clear: async () => undefined,
}
