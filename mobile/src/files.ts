import type { Attachment } from './web'

/**
 * Rules about a task's files (#274) that are not drawing them.
 */

/** Whether a file is shown as an image; anything else is a PDF, the only other type taken. */
export function isImage(attachment: Attachment) {
  return attachment.contentType.startsWith('image/')
}
