/**
 * Everything the app takes from the website's code, in one place (#267).
 *
 * The wire types and validators are generated from the backend's published schema, and the texts,
 * the date words and the board's order are the website's own: the app shows the same board in the
 * same words, so it uses the same code rather than a copy. None of these modules touches the DOM.
 * They are imported from `frontend/` directly, not from a package both sides depend on
 * (`doc/decisions/mobile-app.md`); were they to move, this is the only file that would change.
 * Every text the app shows is in the website's catalogue, the app's own ones included, and the
 * catalogue's test counts the app's code as a use.
 */
import googleSignInDark from '../../frontend/src/assets/google-sign-in-dark.png'
import googleSignInLight from '../../frontend/src/assets/google-sign-in-light.png'

export type {
  AttachmentResponse as Attachment,
  TaskCreateRequest as TaskInput,
  TaskImportance,
  TaskResponse as Task,
  TaskState,
} from '../../frontend/src/generated/types'
export {
  validateAttachmentResponse,
  validateLinkResponse,
  validateRefusalResponse,
  validateTaskResponse,
  validateUploadResponse,
  validateVersionResponse,
} from '../../frontend/src/generated/validators'
export { compareCompleted, compareOpen, importanceLevels, importanceRank } from '../../frontend/src/importance'
export { addDays, bucketOf, calendarParts, describeDueDate, quickDates, todayIso, weekdayBeside, type DueBucket } from '../../frontend/src/dates'
export { catalogues, type Messages } from '../../frontend/src/i18n/messages'
export { chooseLanguage, localeOf, type Language } from '../../frontend/src/i18n/language'
export { needsDatingBack, restoreInput } from '../../frontend/src/restore'
export { imprintUrl, privacyUrls, termsUrls } from '../../frontend/src/links'
export { confirmsEmail } from '../../frontend/src/confirmsEmail'
export { storageUrl } from '../../frontend/src/storage'
export { attachmentLimits, attachmentTypes, checkFile, type AttachmentRefusal } from '../../frontend/src/attachmentPolicy'
export { MAX_THUMBNAIL_BYTES, thumbnailCrop, thumbnailSize } from '../../frontend/src/thumbnail'

/**
 * Google's official "Sign in with Google" button, the images the website shows (#325): Google's
 * rules allow its "G" only inside its own button, in its own light or dark theme, so the image is
 * the button. 180 by 40, in Google's English whatever the app speaks, as on the website.
 */
export const googleSignInButton = { light: googleSignInLight, dark: googleSignInDark, width: 180, height: 40 }
