import { useState } from 'react'

type UserAvatarProps = {
  email: string
  name?: string | null
  pictureUrl?: string | null
}

/**
 * Up to two initials for whoever is signed in.
 *
 * Taken from the display name when there is one, because "GH" identifies a person and "G" from
 * an email barely does. Falls back to the email's local part, which is the only thing always
 * present.
 */
function initialsFor(email: string, name?: string | null) {
  const source = name?.trim() ? name.trim() : email.split('@')[0]
  const words = source.split(/[\s._-]+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

/**
 * The signed-in person, as a picture or as their initials.
 *
 * Three sources in order: the provider's picture, a Gravatar the backend has already confirmed
 * exists, and initials. The first two arrive as one `pictureUrl` — the backend decides between
 * them, because only it can ask Gravatar whether an image is there.
 *
 * It is decorative on purpose: `alt=""` and `aria-hidden` on the initials, because the name or
 * email sits beside it as real text. Labelling it would make a screen reader say the name twice.
 */
function UserAvatar({ email, name, pictureUrl }: UserAvatarProps) {
  // Keyed by URL rather than a boolean, so a new picture is tried afresh instead of inheriting
  // the previous one's failure.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (pictureUrl && failedUrl !== pictureUrl) {
    return (
      <img
        className="user-avatar"
        src={pictureUrl}
        alt=""
        // A URL the backend confirmed can still 404 later, and a broken image icon is worse
        // than initials.
        onError={() => setFailedUrl(pictureUrl)}
      />
    )
  }

  return (
    <span className="user-avatar user-avatar--initials" aria-hidden="true">
      {initialsFor(email, name)}
    </span>
  )
}

export default UserAvatar
