import type { RefusalResponse } from './generated/types'

/**
 * What the backend takes as an attachment (#204), in a module of its own without the DOM or Vite,
 * so the mobile app refuses a file by the same rule as the website rather than a copy of it (#274).
 */

/** Why an attachment was refused, as the backend names it; the website and the app word it alike. */
export type AttachmentRefusal = RefusalResponse['refusal']

/** The types the backend accepts (D2 on #204): PDFs, and the images every browser shows inline. */
export const attachmentTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']

/**
 * The limits the backend enforces (D1 on #204), here only to say them before an upload and to spare
 * one the backend would refuse anyway. The backend's configuration is the authority
 * (`taskfest.attachments.*`); should the two differ, its refusal is what the board shows.
 */
export const attachmentLimits = { maxSizeBytes: 10 * 1024 * 1024, perTask: 2, perUser: 5 }

/**
 * Why the backend would refuse this file, as far as the browser can tell without asking: its type,
 * or its size. Null when it may be sent. The add row checks with it the moment a file is chosen
 * (#216), and `uploadAttachment` before announcing one, so both refuse alike -- and the mobile
 * app (#274), with what its pickers say of a file.
 */
export function checkFile(file: { type: string; size: number }): AttachmentRefusal | null {
  if (!attachmentTypes.includes(file.type)) {
    return 'UNSUPPORTED_TYPE'
  }
  if (file.size === 0) {
    return 'EMPTY'
  }
  return file.size > attachmentLimits.maxSizeBytes ? 'TOO_LARGE' : null
}
