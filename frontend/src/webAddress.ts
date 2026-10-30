/**
 * What a link on a task (#414) is, and whether its address may be opened: shared with the mobile
 * app through its `web.ts`, so both treat a link alike. A module of its own, like `storage.ts`, so
 * the app takes these without the website's requests.
 */

/** The content type a link has among a task's attachments (#414). */
export const LINK_CONTENT_TYPE = 'text/uri-list'

/**
 * Whether a link's address may be opened from the board: a web address, and nothing that runs or
 * embeds when opened -- `javascript:`, `data:`. The backend takes no other; this holds whatever it
 * might one day let through, as the storage links are checked before use.
 */
export function isWebAddress(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host !== ''
  } catch {
    return false
  }
}
