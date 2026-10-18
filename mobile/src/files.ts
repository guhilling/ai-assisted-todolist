import type { Attachment } from './web'

/**
 * Rules about a task's files (#274) that are not drawing them.
 */

/** Whether a type is shown as an image; anything else is a PDF, the only other type taken. */
export function isImageType(contentType: string) {
  return contentType.startsWith('image/')
}

/** Whether a file is shown as an image. */
export function isImage(attachment: Attachment) {
  return isImageType(attachment.contentType)
}
