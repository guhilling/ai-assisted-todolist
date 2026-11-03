import { getCalendars } from 'expo-localization'
import { offerable } from './web'

/**
 * The time zone the phone is in (#477), which a time tied to a zone starts from: from the
 * platform's own calendar settings, since Hermes' `Intl` cannot be relied on to name it. UTC when
 * the platform does not say, or names a fixed offset such as `GMT+1`, which the backend refuses.
 */
export function phoneZone(): string {
  return offerable(getCalendars()[0]?.timeZone ?? null) ?? 'UTC'
}
