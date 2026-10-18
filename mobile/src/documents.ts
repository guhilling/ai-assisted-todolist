/**
 * Opening a PDF in the phone's own viewer (#274), the way each platform does it: iOS's in-app
 * browser shows a PDF from its link by itself; Android's does not, so the file is downloaded into
 * the app's cache and handed to whatever views PDFs there, allowed to read that one file.
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
}

/** Opens a PDF from its signed link, the way the platform does. */
export function documentOpenerFor(platform: string, parts: DocumentParts) {
  return async (url: string, fileName: string): Promise<void> => {
    if (platform === 'android') {
      const copy = await parts.download(url, safeFileName(fileName))
      await parts.view(copy.contentUri, 'application/pdf')
      return
    }
    await parts.openBrowser(url)
  }
}

/**
 * A name for the cached copy: the file's own, with no separator that could put it outside the
 * cache's folder, and ending in `.pdf`, which some viewers go by.
 */
export function safeFileName(fileName: string) {
  const name = fileName.replace(/[/\\:]/g, '_') || 'document'
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`
}
