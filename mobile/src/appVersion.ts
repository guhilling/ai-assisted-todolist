/**
 * Whether this app is too old for the backend it talks to (#268).
 *
 * The backend announces the oldest app release it still serves (`GET /api/version`,
 * `minimumAppVersion`); an older app asks its user to update instead of failing on an API it no
 * longer matches. A development build, `0.0.0`, is never too old, and a version that cannot be read
 * locks nobody out.
 */
export function isTooOld(appVersion: string, minimumAppVersion: string): boolean {
  const app = parse(appVersion)
  const minimum = parse(minimumAppVersion)
  if (!app || !minimum || app.every((part) => part === 0)) {
    return false
  }
  for (let i = 0; i < 3; i++) {
    if (app[i] !== minimum[i]) {
      return app[i] < minimum[i]
    }
  }
  return false
}

function parse(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  return match ? match.slice(1).map(Number) : null
}
