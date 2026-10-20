import { TYPE_BY_EXTENSION, typeOfName } from './pick'
import type { PickedFile } from './upload'
import { attachmentLimits, attachmentTypes, checkFile, type AttachmentRefusal } from './web'

/**
 * Sharing into TaskFest (#355): what another app shared, turned into a task to add -- the text and
 * a link as its description, the files as the ones to attach once it exists.
 *
 * Only what was shared is read. `expo-sharing` could "resolve" a share, but for a link that means
 * requesting it, and for a file a copy under whatever name the sending app gives, at the top of the
 * app's cache -- where `board.json` is, and a name with "../" in it goes further. A link stays text
 * here, and a file is copied by the app itself, into a folder of its own.
 *
 * A file keeps its name where the name says its type -- "Rechnung.pdf" -- and is named by its type
 * otherwise: Android's Files app shares a link ending in a document's number, "image:1000000018",
 * and that is all the app learns of the name.
 *
 * Files are refused, if they must be, by the website's own rule and in its words (`checkFile`), as
 * a picked file is; and a task takes as many as `attachmentLimits.perTask`, the first ones shared.
 *
 * The phone's pieces are passed in (`Main.tsx` gives the real ones), so this is tested without them.
 */

/** One thing another app shared, as `expo-sharing` reports it before resolving anything. */
export type SharedItem = {
  shareType: 'text' | 'url' | 'audio' | 'image' | 'video' | 'file'
  /** The text, the link, or where the file is. */
  value: string
  mimeType?: string
}

/** What reading a shared file needs of the phone. */
export type IncomingParts = {
  /**
   * The file's name -- the end of its link -- its type and its size, as far as the phone can tell
   * without reading it; null, or a size of 0, where it cannot.
   */
  describe(uri: string): { name: string | null; type: string | null; size: number | null }
  /** Copies the file into the app, under this name; the copy and its size. */
  copy(uri: string, name: string): Promise<{ uri: string; size: number }>
  /** A JPEG of an image, for one the backend would not take as it is. */
  toJpeg(uri: string): Promise<{ uri: string; size: number }>
  /** Lets a copy go that the draft does not keep. */
  discard(uri: string): void
}

/** Why a shared file was not taken: the backend's reasons, or that the phone could not read it. */
export type SharedRefusal = AttachmentRefusal | 'UNREADABLE'

/** A task to add, as a share makes it: the files the form attaches, and those it says were refused. */
export type SharedDraft = {
  description: string
  files: PickedFile[]
  refused: { name: string; refusal: SharedRefusal }[]
}

/** The longest description the backend takes (`TaskCreateRequest`'s `maxLength`). */
export const DESCRIPTION_MAX_LENGTH = 255

/** The ending a type's files have, for a file named by its type. */
const ENDING_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_BY_EXTENSION)
    .reverse()
    .map(([extension, type]) => [type, extension]),
)

/** An iPhone's photo, which becomes a JPEG. */
const isHeic = (type: string) => type === 'image/heic' || type === 'image/heif'

/** A type the app can attach: one the backend takes, or HEIC, which becomes one. */
const isTaken = (type: string) => attachmentTypes.includes(type) || isHeic(type)

/** The draft a share makes, or null when nothing was shared. */
export async function draftOf(items: SharedItem[], parts: IncomingParts): Promise<SharedDraft | null> {
  if (items.length === 0) {
    return null
  }
  const texts = items.filter((item) => item.shareType === 'text' || item.shareType === 'url')
  const draft: SharedDraft = {
    description: cut(
      texts
        .map((item) => item.value.trim())
        .filter((value) => value !== '')
        .join(' '),
    ),
    files: [],
    refused: [],
  }
  for (const item of items.filter((each) => !texts.includes(each))) {
    const described = parts.describe(item.value)
    const named = fileName(described.name)
    // A type the app takes, whoever says it: some apps say "image/jpg" of a photo.jpg.
    const said = [item.mimeType, described.type, named ? typeOfName(named) : undefined].map(concrete)
    const type = said.find((each) => each && isTaken(each)) ?? said.find(Boolean) ?? ''
    const name = named && typeOfName(named) ? named : `shared${ENDING_BY_TYPE[type] ? `.${ENDING_BY_TYPE[type]}` : ''}`
    // A refusal names the file as the user knows it, whatever it would have been called here.
    const refuse = (refusal: SharedRefusal) => draft.refused.push({ name: named ?? name, refusal })
    if (draft.files.length === attachmentLimits.perTask) {
      refuse('TASK_FULL')
    } else if (!isTaken(type)) {
      refuse('UNSUPPORTED_TYPE')
    } else if (!isHeic(type) && described.size && described.size > attachmentLimits.maxSizeBytes) {
      // Not copied only to be refused: a film's worth of PDF would take a while.
      refuse('TOO_LARGE')
    } else {
      const file = await take(item.value, name, type, parts)
      const refusal = file ? checkFile(file) : 'UNREADABLE'
      if (refusal) {
        if (file) {
          parts.discard(file.uri)
        }
        refuse(refusal)
      } else {
        draft.files.push(file!)
      }
    }
  }
  return draft
}

/**
 * The file copied into the app -- a JPEG, if it was HEIC, and its copy let go -- or null when it
 * could not be read: a permission withdrawn, say, or a damaged photo.
 */
async function take(uri: string, name: string, type: string, parts: IncomingParts): Promise<PickedFile | null> {
  let copy: { uri: string; size: number }
  try {
    copy = await parts.copy(uri, name)
  } catch (failure) {
    console.warn('A shared file could not be copied', failure)
    return null
  }
  if (!isHeic(type)) {
    return { uri: copy.uri, name, type, size: copy.size }
  }
  try {
    const jpeg = await parts.toJpeg(copy.uri)
    return { uri: jpeg.uri, name: name.replace(/\.[^.]*$/, '') + '.jpg', type: 'image/jpeg', size: jpeg.size }
  } catch (failure) {
    console.warn('A shared photo could not be converted', failure)
    return null
  } finally {
    parts.discard(copy.uri)
  }
}

/**
 * The description, cut to the backend's limit, which counts UTF-16 units as JavaScript does: never
 * through a character that takes two, an emoji's, though an emoji made of several may lose its end.
 * The form shows it before anything is added.
 */
function cut(text: string) {
  if (text.length <= DESCRIPTION_MAX_LENGTH) {
    return text
  }
  const end = /[\uD800-\uDBFF]/.test(text[DESCRIPTION_MAX_LENGTH - 1]) ? DESCRIPTION_MAX_LENGTH - 1 : DESCRIPTION_MAX_LENGTH
  return text.slice(0, end)
}

/** A type that names one: not "image/*", which a share may say of any image. */
function concrete(type: string | null | undefined) {
  return type && !type.includes('*') ? type : undefined
}

/**
 * The name's last path segment, as a person would read it, without control characters; null when
 * nothing is left of it. A file's name is often the end of its link, escaped as a link's is.
 */
function fileName(name: string | null) {
  let last = (name ?? '').split(/[/\\]/).pop()!
  try {
    last = decodeURIComponent(last).split(/[/\\]/).pop()!
  } catch {
    // Not escaped: "100% done.pdf" is a name as it is.
  }
  last = [...last]
    .filter((character) => character >= ' ' && character !== '\u007f')
    .join('')
    .trim()
  return last === '' || last === '.' || last === '..' ? null : last
}
