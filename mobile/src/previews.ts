import type { Attachment } from './web'

/**
 * The previews kept on the phone (#397), so the board kept for reading offline (#272) shows its
 * files' previews too: each one the board has shown -- an image's thumbnail, or the image itself
 * when it has none -- under its attachment's id. An attachment never changes, so its id is all a
 * kept preview needs to stay right; one whose attachment has left the board goes when the board is
 * next kept, and all of them go with the session.
 *
 * What is kept is whatever the board shows as a preview, not an image as such, so a preview of
 * another kind can be kept here when there is one.
 */

/** Keeps, finds and forgets the previews. */
export type PreviewStore = {
  /** Where the kept preview of an attachment is, or null when none is kept. */
  find(attachmentId: Attachment['id']): Promise<string | null>
  /** Downloads a preview from its link and keeps it, saying where; rejects, keeping nothing, when it cannot. */
  keep(attachmentId: Attachment['id'], url: string): Promise<string>
  /** Forgets every kept preview but those of these attachments. */
  retain(attachmentIds: Iterable<Attachment['id']>): Promise<void>
  /** Forgets them all. */
  clear(): Promise<void>
}

/** The folder the previews are kept in, by name: what this needs of expo-file-system, so tests keep it in memory. */
export type PreviewFolder = {
  /** Where the named file is, or null when there is none. */
  find(name: string): string | null
  /** Downloads a link into the named file, saying where it is; rejects, leaving no such file, on any failure. */
  download(url: string, name: string): Promise<string>
  names(): string[]
  remove(name: string): void
  clear(): void
}

/** Previews kept in a folder of their own, one file per attachment, named by its id. */
export function createPreviewStore(folder: PreviewFolder): PreviewStore {
  return {
    async find(attachmentId) {
      return folder.find(String(attachmentId))
    },

    keep(attachmentId, url) {
      return folder.download(url, String(attachmentId))
    },

    async retain(attachmentIds) {
      const wanted = new Set([...attachmentIds].map(String))
      // Anything else in the folder goes too: a file of an older layout, say.
      folder
        .names()
        .filter((name) => !wanted.has(name))
        .forEach((name) => folder.remove(name))
    },

    async clear() {
      folder.clear()
    },
  }
}
