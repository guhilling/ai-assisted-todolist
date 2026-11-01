import type { PickedFile } from './upload'

/**
 * Picking a file to attach (#274): a photo taken with the camera, one chosen from the library, or
 * any file from the file picker, as the platform's pickers report it.
 *
 * An iPhone's photo may be HEIC, which the backend does not take (`attachmentTypes`): it becomes a
 * JPEG here. Anything else the pickers hand over is passed on as it is, and refused, if it must be,
 * by the website's own rule before anything is sent (`upload.ts`).
 *
 * The platform's pieces are passed in (`Main.tsx` gives the real ones), so this is tested without them.
 */

/** Where a file comes from. */
export type PickSource = 'camera' | 'library' | 'files'

/** A photo as the image picker reports it, any field it may leave out as null. */
export type PickedPhoto = {
  uri: string
  fileName: string | null
  mimeType: string | null
  fileSize: number | null
  width?: number
  height?: number
}

/** What picking needs of the platform. */
export type PickerParts = {
  /** Whether the app may use the camera, asking the user first if they have not answered. */
  cameraAllowed(): Promise<boolean>
  /** A photo taken; null when the user turned back. */
  camera(): Promise<PickedPhoto | null>
  /** A photo chosen from the library; null when the user turned back. */
  library(): Promise<PickedPhoto | null>
  /** Any file chosen, as the document picker names it; null when the user turned back. */
  files(): Promise<{ uri: string; name: string; type: string | null; size: number | null } | null>
  /** A file's size, for a picker that does not say. */
  sizeOf(uri: string): number
  /** A JPEG of an image, for one the backend would not take as it is. */
  toJpeg(uri: string): Promise<{ uri: string; size: number }>
  /** Lets a picker's copy go that is not attached: a HEIC photo, once it is a JPEG (#432). */
  discard?(uri: string): void
  now(): number
}

/** The camera may not be used: the user said no, now or before. */
export class CameraRefusedError extends Error {
  constructor() {
    super('The camera may not be used.')
    this.name = 'CameraRefusedError'
  }
}

/** The types a file's name says, for a picker that does not say its type. */
export const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
}

/** The type a file's name says, if it says one this knows. */
export function typeOfName(name: string): string | undefined {
  return TYPE_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? '']
}

/**
 * A file picked from the source, or null when the user turned back.
 *
 * @throws CameraRefusedError when the camera may not be used
 */
export async function pickFile(source: PickSource, parts: PickerParts): Promise<PickedFile | null> {
  if (source === 'files') {
    const file = await parts.files()
    return (
      file && {
        uri: file.uri,
        name: file.name,
        type: file.type ?? typeOfName(file.name) ?? '',
        size: file.size ?? parts.sizeOf(file.uri),
      }
    )
  }
  if (source === 'camera' && !(await parts.cameraAllowed())) {
    throw new CameraRefusedError()
  }
  const photo = source === 'camera' ? await parts.camera() : await parts.library()
  return photo && asFile(photo, parts)
}

/**
 * A photo as a file to attach: named, typed and sized, and a JPEG if it was HEIC. A type neither
 * the picker nor the name says stays unknown -- empty, as for any file -- for the upload to refuse;
 * only the name made up here for a photo without one says JPEG.
 */
async function asFile(photo: PickedPhoto, parts: PickerParts): Promise<PickedFile> {
  const name = photo.fileName ?? `photo-${stamp(parts.now())}.jpg`
  const type = photo.mimeType ?? typeOfName(name) ?? ''
  if (type === 'image/heic' || type === 'image/heif') {
    try {
      const jpeg = await parts.toJpeg(photo.uri)
      return { uri: jpeg.uri, name: name.replace(/\.[^.]*$/, '') + '.jpg', type: 'image/jpeg', size: jpeg.size }
    } finally {
      parts.discard?.(photo.uri)
    }
  }
  const measured = photo.width && photo.height ? { width: photo.width, height: photo.height } : {}
  return { uri: photo.uri, name, type, size: photo.fileSize ?? parts.sizeOf(photo.uri), ...measured }
}

/** A moment as a file name may carry it: 2026-10-18-0930, in UTC. */
function stamp(epochMs: number) {
  const iso = new Date(epochMs).toISOString()
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`
}
