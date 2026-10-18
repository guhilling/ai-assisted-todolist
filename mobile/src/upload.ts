import type { Announcement, Caller, FileAnnouncement } from './api'
import { AttachmentRefusedError } from './api'
import { checkFile, MAX_THUMBNAIL_BYTES, type Attachment, type Task } from './web'

/**
 * Attaching a file from the phone (#274), as the website does it (`uploadAttachment` in
 * `frontend/src/api.ts`): refused on the phone when the backend would refuse it anyway, by the
 * website's own rule; announced; uploaded straight to storage, beside its thumbnail; and confirmed.
 * The content never passes through the backend.
 *
 * The phone's pieces -- uploading a file, making a thumbnail -- are passed in (`Main.tsx` gives
 * the real ones), so this is tested without them.
 */

/**
 * A file picked on the phone: where it is, and what the pickers say of it -- an image's size in
 * pixels too, when the picker knows it, so it need not be decoded to be measured.
 */
export type PickedFile = { uri: string; name: string; type: string; size: number; width?: number; height?: number }

/** The backend's side of attaching: `announceAttachment` and `confirmAttachment`. */
export type UploadApi = {
  announce(caller: Caller, taskId: Task['id'], file: FileAnnouncement): Promise<Announcement>
  confirm(caller: Caller, taskId: Task['id'], attachmentId: Attachment['id']): Promise<Attachment>
}

/** What attaching needs of the phone. */
export type UploadParts = {
  /** PUTs a file to a signed link with exactly the headers it was signed for; rejects on any failure. */
  put(uri: string, url: string, headers: Record<string, string>, onProgress?: (fraction: number) => void): Promise<void>
  /** A JPEG thumbnail of a photo, or null when none could be made small enough. */
  thumbnail(file: PickedFile): Promise<{ uri: string; size: number } | null>
}

/**
 * Attaches a file to a task, reporting the upload's progress as a fraction.
 *
 * A photo -- a JPEG larger than a thumbnail may be -- brings a thumbnail, made on the phone and
 * uploaded beside it before the confirmation, which is when the backend looks for it. Only a JPEG:
 * a thumbnail is a JPEG, and a PNG's transparency would come out black, where the website draws it
 * on white. A thumbnail is optional throughout: one that cannot be made, or does not reach
 * storage, leaves the file as it would have been without, and its row shows the file itself.
 *
 * @throws AttachmentRefusedError when the file is refused, here or by the backend
 */
export async function uploadFile(
  caller: Caller,
  taskId: Task['id'],
  file: PickedFile,
  onProgress: (fraction: number) => void,
  api: UploadApi,
  parts: UploadParts,
): Promise<Attachment> {
  const refusal = checkFile(file)
  if (refusal) {
    throw new AttachmentRefusedError(refusal)
  }
  const thumbnail =
    file.type === 'image/jpeg' && file.size > MAX_THUMBNAIL_BYTES ? await parts.thumbnail(file).catch(() => null) : null
  const announced = await api.announce(caller, taskId, {
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    ...(thumbnail ? { thumbnailSizeBytes: thumbnail.size } : {}),
  })
  const thumbnailUpload = announced.thumbnailUpload
  await Promise.all([
    parts.put(file.uri, announced.url, announced.headers, onProgress),
    thumbnail && thumbnailUpload
      ? parts.put(thumbnail.uri, thumbnailUpload.url, thumbnailUpload.headers, undefined).catch(() => undefined)
      : undefined,
  ])
  return api.confirm(caller, taskId, announced.attachment.id)
}
