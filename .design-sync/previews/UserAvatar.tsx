import { UserAvatar } from 'frontend'

/**
 * A data URI rather than a real picture URL.
 *
 * The component falls back to initials when the image fails to load, so a preview pointing at
 * a real avatar host would render the fallback whenever the screenshot runs offline -- and
 * quietly claim to show the picture case. This one always loads.
 */
const PICTURE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E" +
  "%3Crect width='96' height='96' fill='%231a73e8'/%3E" +
  "%3Ccircle cx='48' cy='38' r='17' fill='%23ffffff'/%3E" +
  "%3Cpath d='M16 96c0-18 14-30 32-30s32 12 32 30z' fill='%23ffffff'/%3E%3C/svg%3E"

export function WithPicture() {
  return <UserAvatar email="alice@example.com" name="Alice Example" pictureUrl={PICTURE} />
}

/** No picture from the provider: initials, taken from the name. */
export function Initials() {
  return <UserAvatar email="alice@example.com" name="Alice Example" />
}

/** No name either, so the email is all there is to work with. */
export function FromEmailAlone() {
  return <UserAvatar email="gunnar@example.com" />
}
