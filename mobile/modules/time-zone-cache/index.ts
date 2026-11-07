/**
 * Lets the app's JavaScript follow a change of the phone's time zone without a restart (#526).
 *
 * Hermes keeps the zone it read first for every `Date` until the app restarts, and React Native
 * does not tell it otherwise; this module's native side drops that cache. Optional, so that Jest
 * and Expo Go, which do not carry the module, simply go on without it.
 */

import { requireOptionalNativeModule } from 'expo'

type TimeZoneCacheModule = { reset(): void }

const native = requireOptionalNativeModule<TimeZoneCacheModule>('TimeZoneCache')

/** Makes `Date` and the phone's zone, read next, those of the phone's current time zone. */
export function resetTimeZoneCache(): void {
  native?.reset()
}
