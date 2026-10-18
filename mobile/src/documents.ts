/**
 * Opening a file other than an image in the phone's own viewer (#274), the way each platform does
 * it: iOS's in-app browser shows a PDF from its link by itself; Android's does not, so the file is
 * downloaded into the app's cache and handed to whatever views its type there, allowed to read that
 * one file. The copies go when the session does -- and a copy that arrives after its session ended
is neither viewed nor kept.
 *
 * The platform's pieces are passed in (`Main.tsx` gives the real ones), so this is tested without them.
 */

/** What opening a document needs of the platform. */
export type DocumentParts = {
  /** Shows a link in the in-app browser (iOS). */
  openBrowser(url: string): Promise<unknown>
  /** Downloads a file into the app's cache under this name, overwriting an older copy (Android). */
  download(url: string, fileName: string): Promise<{ contentUri: string }>
  /** Hands a file to the app that views its type, allowed to read it (Android). */
  view(contentUri: string, mimeType: string): Promise<unknown>
  /** Deletes every copy downloaded (Android); nothing to do where none are made. */
  forget(): Promise<void>
  /** Deletes the one copy under this name (Android); none where no copies are made. */
  discard?(fileName: string): Promise<void>
}

/** Opens documents from their signed links the way the platform does, and forgets the copies. */
export function documentsFor(platform: string, parts: DocumentParts) {
  /** How often the copies were forgotten: a download that began before the last time is not wanted. */
  let forgotten = 0
  return {
    async open(url: string, fileName: string, contentType: string): Promise<void> {
      if (platform === 'android') {
        const started = forgotten
        const name = safeFileName(fileName)
        const copy = await parts.download(url, name)
        if (forgotten !== started) {
          await parts.discard?.(name)
          return
        }
        await parts.view(copy.contentUri, contentType)
        return
      }
      await parts.openBrowser(url)
    },
    forget: () => {
      forgotten += 1
      return parts.forget()
    },
  }
}

/**
 * A name for the cached copy: the file's own, with no separator that could put it outside the
 * cache's folder.
 */
export function safeFileName(fileName: string) {
  const name = fileName.replace(/[/\\:]/g, '_')
  // Nothing but dots would name the folder itself, or the one above it.
  return /^\.*$/.test(name) ? 'document' : name
}
