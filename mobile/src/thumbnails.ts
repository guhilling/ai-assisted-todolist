import type { PickedFile } from './upload'
import { MAX_THUMBNAIL_BYTES, thumbnailCrop, thumbnailSize } from './web'

/**
 * A photo's thumbnail, made on the phone while it is attached (#274), by the website's own rule
 * (`frontend/src/thumbnail.ts`): its shorter side twice the row's preview, the middle of a
 * panorama, a JPEG -- and none when the photo would not be scaled down, or the thumbnail would be
 * larger than the backend takes.
 *
 * The platform's image pieces are passed in (`Main.tsx` gives expo-image-manipulator), so this is
 * tested without them.
 */

/** What making a thumbnail needs of the platform. */
export type ThumbnailParts = {
  /** An image's size in pixels, turned as the camera meant. */
  dimensions(uri: string): Promise<{ width: number; height: number }>
  /** The part of an image cropped and drawn at a size, saved as a JPEG at 0.8. */
  render(
    uri: string,
    crop: { originX: number; originY: number; width: number; height: number },
    size: { width: number; height: number },
  ): Promise<{ uri: string; size: number }>
}

/** A JPEG thumbnail of the photo, or null when it needs none or none small enough could be made. */
export async function makeThumbnail(file: PickedFile, parts: ThumbnailParts): Promise<{ uri: string; size: number } | null> {
  // The picker's own measure where it gave one: decoding a 48-megapixel photo only to learn its
  // size is a few hundred megabytes spent for two numbers.
  const { width, height } = file.width && file.height ? { width: file.width, height: file.height } : await parts.dimensions(file.uri)
  const size = thumbnailSize(width, height)
  if (size.width >= width) {
    return null
  }
  const thumbnail = await parts.render(file.uri, thumbnailCrop(width, height, size), size)
  return thumbnail.size <= MAX_THUMBNAIL_BYTES ? thumbnail : null
}
