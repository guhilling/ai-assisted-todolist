/**
 * Everything the app takes from the website's code, in one place (#267).
 *
 * The wire types and validators are generated from the backend's published schema, and the texts,
 * the date words and the board's order are the website's own: the app shows the same board in the
 * same words, so it uses the same code rather than a copy. None of these modules touches the DOM.
 * They are imported from `frontend/` directly for now; whether they move into a package both sides
 * depend on is an open question on #267, and this file is the only one that would change.
 */
export type { TaskImportance, TaskResponse as Task, TaskState } from '../../frontend/src/generated/types'
export { validateTaskResponse, validateVersionResponse } from '../../frontend/src/generated/validators'
export { compareCompleted, compareOpen } from '../../frontend/src/importance'
export { bucketOf, describeDueDate, todayIso, type DueBucket } from '../../frontend/src/dates'
export { catalogues, type Messages } from '../../frontend/src/i18n/messages'
export { chooseLanguage, localeOf, type Language } from '../../frontend/src/i18n/language'
