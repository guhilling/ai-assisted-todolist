import { TYPE_BY_EXTENSION, typeOfName } from './pick'
import type { PickedFile } from './upload'
import { attachmentLimits, attachmentTypes, checkFile, isWebAddress, type AttachmentRefusal } from './web'

/**
 * Sharing into TaskFest (#355): what another app shared, turned into a task to add -- the text as
 * its description, the files as the ones to attach once it exists, and a link as a link on it
 * (#414), titled by the page where the sharing app said its title.
 *
 * A page's title arrives as text beside its link: Safari's, and Chrome's subject on Android, which
 * the build passes on as a text item of its own (`shareExtension.ts`, `patches/`). So with a link,
 * the text is both the description and the link's title; a link alone has neither.
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
  /**
   * Lets a shared file go once it is read, where it is the app's to: on an iPhone, the copy the
   * share extension leaves for the app (#356). Android's are the sending app's, and stay.
   */
  release?(uri: string): void
}

/** Why a shared file was not taken: the backend's reasons, or that the phone could not read it. */
export type SharedRefusal = AttachmentRefusal | 'UNREADABLE'

/** A link a share brought (#414): its address, and the page's title where the sharing app gave one. */
export type SharedLink = { url: string; title: string | null }

/**
 * A task to add, as a share makes it: the files and links the form attaches, and those it says were
 * refused.
 */
export type SharedDraft = {
  description: string
  files: PickedFile[]
  /** The links it brought (#414); none when absent. */
  links?: SharedLink[]
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
  // A "link" the backend would not take -- Android takes "notes.md" for an address, iOS any scheme
  // -- stays text, as every link was before #414, rather than being lost on the way.
  const links = items.filter((item) => item.shareType === 'url' && isLinkable(item.value.trim()))
  const texts = items.filter((item) => item.shareType === 'text' || (item.shareType === 'url' && !links.includes(item)))
  const description = cut(
    texts
      .map((item) => item.value.trim())
      .filter((value) => value !== '')
      .join(' '),
  )
  const draft: SharedDraft = { description, files: [], refused: [] }
  for (const item of items.filter((each) => !texts.includes(each) && !links.includes(each))) {
    try {
      await read(item, draft, parts)
    } finally {
      parts.release?.(item.value)
    }
  }
  // After the files, which a share is mostly for: a link takes what room the task has left. The text
  // is a link's title only when it is the one link; of several, nothing says which title is whose.
  const title = links.length === 1 && description !== '' ? description : null
  const taken: SharedLink[] = []
  for (const item of links) {
    const url = item.value.trim()
    if (draft.files.length + taken.length === attachmentLimits.perTask) {
      draft.refused.push({ name: url, refusal: 'TASK_FULL' })
    } else {
      taken.push({ url, title })
    }
  }
  return taken.length > 0 ? { ...draft, links: taken } : draft
}

/** What another app shared, as the platform keeps it for the app: `expo-sharing`'s payloads. */
export type ShareInbox = {
  /** The share kept, or none. */
  read(): SharedItem[]
  /** Lets it go: the app is done with it. */
  clear(): void
}

/** The shares the app takes, and the one it tells when a share's form has opened. */
export type IncomingShares = {
  /** The share kept, as a draft, the first time this run sees it; null when there is none new. */
  take(): Promise<SharedDraft | null>
  /** The draft's form has opened: the share is let go where the platform keeps it, with its files. */
  settle(draft: SharedDraft): void
}

/**
 * The shares the platform keeps, taken as drafts (#432). A share stays where the platform keeps it
 * -- an iPhone's App Group, which outlives the app -- until its form opens, and so do the files the
 * share extension left there: an app the system ends before the board could take the share, while
 * the user signs in, finds it again the next time it starts.
 *
 * So a share is taken once a run, however often the app comes back to the foreground meanwhile,
 * and only the latest is kept: the platform keeps one, which a newer share replaces, so one that
 * waits behind another lives only as long as the run. `forgetLeft` lets go the copies an earlier
 * run left behind, before a share is copied anew.
 */
export function sharesFrom(inbox: ShareInbox, parts: IncomingParts, forgetLeft: () => void = () => undefined): IncomingShares {
  /** The share last taken, as the platform holds it; null when none is, or it was let go. */
  let taken: string | null = null
  const kept = new Map<SharedDraft, { share: string; files: string[] }>()
  const { release, ...reading } = parts
  return {
    async take() {
      const items = inbox.read()
      const share = JSON.stringify(items)
      if (items.length === 0 || share === taken) {
        return null
      }
      forgetLeft()
      // Its files stay where the extension left them until the form opens: `settle` lets them go.
      const draft = (await draftOf(items, reading))!
      taken = share
      const files = items.filter((item) => item.shareType !== 'text' && item.shareType !== 'url').map((item) => item.value)
      kept.set(draft, { share, files })
      return draft
    },
    settle(draft) {
      const known = kept.get(draft)
      if (!known) {
        return
      }
      kept.delete(draft)
      known.files.forEach((uri) => release?.(uri))
      // A newer share has replaced it there meanwhile: that one stays, until its own form opens.
      if (JSON.stringify(inbox.read()) === known.share) {
        inbox.clear()
        taken = null
      }
    },
  }
}

/** The longest address the backend keeps for a link (`LinkRequest`'s `maxLength`, which a test compares). */
export const LINK_MAX_LENGTH = 2048

/** Whether the backend takes this as a link's address: a web address it can keep. */
function isLinkable(url: string) {
  return url.length <= LINK_MAX_LENGTH && isWebAddress(url)
}

/** What the phone can tell of a file, or null when it cannot even say that: a permission withdrawn. */
function describe(uri: string, parts: IncomingParts) {
  try {
    return parts.describe(uri)
  } catch (failure) {
    console.warn('A shared file could not be described', failure)
    return null
  }
}

/** Adds a shared file to the draft: copied into the app, or among those it says were refused. */
async function read(item: SharedItem, draft: SharedDraft, parts: IncomingParts) {
  const described = describe(item.value, parts)
  const named = fileName(described?.name ?? null)
  // A type the app takes, whoever says it: some apps say "image/jpg" of a photo.jpg.
  const said = [item.mimeType, described?.type, named ? typeOfName(named) : undefined].map(concrete)
  const type = said.find((each) => each && isTaken(each)) ?? said.find(Boolean) ?? ''
  const name = named && typeOfName(named) ? named : `shared${ENDING_BY_TYPE[type] ? `.${ENDING_BY_TYPE[type]}` : ''}`
  // A refusal names the file as the user knows it, whatever it would have been called here.
  const refuse = (refusal: SharedRefusal) => draft.refused.push({ name: named ?? name, refusal })
  if (!described) {
    refuse('UNREADABLE')
  } else if (draft.files.length === attachmentLimits.perTask) {
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
