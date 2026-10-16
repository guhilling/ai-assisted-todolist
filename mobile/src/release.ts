/**
 * Which release a build is, as the stores number it (#276): the version testers see, and the
 * build number each store needs to rise with every upload.
 *
 * Read by `app.config.ts` when a build is made. The release workflow sets both from the tag and
 * its own run (`doc/mobile/distribution.md`); a build from a branch is 0.0.0, build 1, and never
 * reaches a store.
 */

/** The version (`CFBundleShortVersionString`, `versionName`) and the build number (`CFBundleVersion`, `versionCode`). */
export type Release = { version: string; buildNumber: number }

/** Build-time values the release numbers come from. */
export type ReleaseEnvironment = Record<string, string | undefined>

/** A store version is three numbers; a pre-release suffix is refused by both stores. */
const STORE_VERSION = /^\d+\.\d+\.\d+$/

/** The release a build with this environment is. */
export function releaseOf(env: ReleaseEnvironment): Release {
  const version = env.TASKFEST_VERSION ?? '0.0.0'
  if (!STORE_VERSION.test(version)) {
    throw new Error(`TASKFEST_VERSION is ${version}; a store takes three numbers, like 1.4.0.`)
  }
  const raw = env.TASKFEST_BUILD_NUMBER
  if (raw === undefined) return { version, buildNumber: 1 }
  const buildNumber = /^\d+$/.test(raw) ? Number(raw) : NaN
  if (!(buildNumber >= 1)) {
    throw new Error(`TASKFEST_BUILD_NUMBER is ${raw}; it must be a whole number from 1.`)
  }
  return { version, buildNumber }
}
