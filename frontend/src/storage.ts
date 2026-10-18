/**
 * The rule for links to storage (#204, #274), in a module of its own without the DOM or Vite, so
 * the mobile app follows the same rule as the website rather than a copy of it.
 */

/**
 * A link to storage, checked before a file is sent to it or it is opened: HTTPS, or plain HTTP only
 * to this machine -- the local stack's storage, `s3.localhost` or `localhost`. Anything else is a
 * broken answer, not somewhere to send a user's file or to open.
 *
 * The link comes from this application's own backend, which signed it; SonarCloud's taint analysis
 * still counts every response as forged input (S8476, client-side request forgery), as it did a
 * task id (`taskUrl`). The check is a few lines, so the link is checked rather than the finding
 * waved through each time it comes back under a new key (`doc/decisions/frontend.md`).
 *
 * @returns the link exactly as it came -- a signed link must not be rewritten, not even by the URL
 *   parser's normalising -- or null when it may not be used
 */
export function storageUrl(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  const local = url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname === '127.0.0.1'
  return url.protocol === 'https:' || (url.protocol === 'http:' && local) ? link : null
}
