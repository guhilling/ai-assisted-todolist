/**
 * Preview thumbnails, made in the browser while it uploads an image (#236).
 *
 * The browser has the file already, so it scales it down here and uploads the result next to it:
 * the row then shows a few kilobytes instead of a photo of several megabytes, and the backend needs
 * no image library. A thumbnail is optional throughout -- anything that goes wrong making one
 * leaves the upload as it was without, and the row shows the file itself.
 */

/** Twice the row's 64 px box, so it stays sharp on a high-density screen. */
const EDGE = 128

/** The longest side a thumbnail is given; a panorama beyond it is cropped to its middle. */
const LONGEST = 4 * EDGE

/** The largest thumbnail the backend accepts (`taskfest.attachments.max-thumbnail-bytes`). */
const MAX_BYTES = 64 * 1024

/**
 * The size to draw an image of this size at: its shorter side covers the row's box twice over, as
 * the box crops to fill, and nothing is ever enlarged.
 */
export function thumbnailSize(width: number, height: number) {
  const scale = EDGE / Math.min(width, height)
  if (scale >= 1) {
    return { width, height }
  }
  return {
    width: Math.min(Math.round(width * scale), LONGEST),
    height: Math.min(Math.round(height * scale), LONGEST),
  }
}

/**
 * A JPEG thumbnail of an image file, or null when it needs none -- a file small enough to show as
 * it is, which keeps a PNG's transparency and a GIF's animation, or an image that would not be
 * scaled down -- or when this browser cannot make one, or it would not be small enough. Drawn on
 * white, since a JPEG has no transparency to keep, and turned as the camera meant, as the row would
 * show the file itself.
 */
export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (file.size <= MAX_BYTES || typeof createImageBitmap !== 'function') {
    return null
  }
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const size = thumbnailSize(bitmap.width, bitmap.height)
    const canvas = size.width < bitmap.width ? canvasOf(size) : null
    const context = canvas?.getContext('2d')
    if (!canvas || !context) {
      return null
    }
    // The part of the image the thumbnail shows: all of it, or the middle of a panorama.
    const scale = Math.max(size.width / bitmap.width, size.height / bitmap.height)
    const sourceWidth = size.width / scale
    const sourceHeight = size.height / scale
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth,
      sourceHeight, 0, 0, size.width, size.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    return blob && blob.type === 'image/jpeg' && blob.size <= MAX_BYTES ? blob : null
  } catch {
    return null
  } finally {
    // The decoded image is the full photo, tens of megabytes: let it go whatever happened.
    bitmap?.close()
  }
}

/** A canvas of this size to draw on. */
function canvasOf(size: { width: number; height: number }) {
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  return canvas
}
