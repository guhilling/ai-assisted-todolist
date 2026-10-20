import { TYPE_BY_EXTENSION, typeOfName } from './pick'
import type { PickedFile } from './upload'
import { attachmentLimits, checkFile, type AttachmentRefusal } from './web'

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
  /** The file's name -- the end of its link -- and its type; null where they are not known. */
  describe(uri: string): { name: string | null; type: string | null }
  /** Copies the file into the app, under this name; the copy and its size. */
  copy(uri: string, name: string): Promise<{ uri: string; size: number }>
  /** A JPEG of an image, for one the backend would not take as it is. */
  toJpeg(uri: string): Promise<{ uri: string; size: number }>
}

/** A task to add, as a share makes it: the files the form attaches, and those it says were refused. */
export type SharedDraft = {
  description: string
  files: PickedFile[]
  refused: { name: string; refusal: AttachmentRefusal }[]
}

/** The longest description the backend takes (`TaskCreateRequest`'s `maxLength`). */
export const DESCRIPTION_MAX_LENGTH = 255

/** The ending a type's files have, for a file named by its type. */
const ENDING_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_BY_EXTENSION)
    .reverse()
    .map(([extension, type]) => [type, extension]),
)

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
    const type = concrete(item.mimeType) ?? concrete(described.type) ?? (named ? typeOfName(named) : undefined) ?? ''
    const name = named && typeOfName(named) ? named : `shared${ENDING_BY_TYPE[type] ? `.${ENDING_BY_TYPE[type]}` : ''}`
    // A refusal names the file as the user knows it, whatever it would have been called here.
    if (draft.files.length === attachmentLimits.perTask) {
      draft.refused.push({ name: named ?? name, refusal: 'TASK_FULL' })
      continue
    }
    const file = await take(item.value, name, type, parts)
    const refusal = file ? checkFile(file) : 'UNSUPPORTED_TYPE'
    if (refusal) {
      draft.refused.push({ name: named ?? name, refusal })
    } else {
      draft.files.push(file!)
    }
  }
  return draft
}

/** The file copied into the app -- a JPEG if it was HEIC -- or null for a type it would not take. */
async function take(uri: string, name: string, type: string, parts: IncomingParts): Promise<PickedFile | null> {
  if (type === 'image/heic' || type === 'image/heif') {
    const copy = await parts.copy(uri, name)
    const jpeg = await parts.toJpeg(copy.uri)
    return { uri: jpeg.uri, name: name.replace(/\.[^.]*$/, '') + '.jpg', type: 'image/jpeg', size: jpeg.size }
  }
  if (checkFile({ type, size: 1 }) === 'UNSUPPORTED_TYPE') {
    return null
  }
  const copy = await parts.copy(uri, name)
  return { uri: copy.uri, name, type, size: copy.size }
}

/** The description, cut to the backend's limit -- before a character, never through one. */
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
