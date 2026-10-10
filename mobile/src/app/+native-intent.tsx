/**
 * Keeps the sign-in's return out of the router (#267).
 *
 * The provider sends the browser back to `<scheme>://oauthredirect?code=…`, and that is meant for
 * `expo-auth-session`, which is waiting for it. Expo Router would otherwise treat it as a page and
 * show "Unmatched Route" over the app. So it stays on the board's route, where the sign-in started.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    return path.includes('oauthredirect') ? '/' : path
  } catch {
    return '/'
  }
}
