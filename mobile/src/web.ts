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
export type {
  TaskCreateRequest as TaskInput,
  TaskImportance,
  TaskResponse as Task,
  TaskState,
} from '../../frontend/src/generated/types'
export { validateTaskResponse, validateVersionResponse } from '../../frontend/src/generated/validators'
export { compareCompleted, compareOpen, importanceLevels, importanceRank } from '../../frontend/src/importance'
export { addDays, bucketOf, describeDueDate, quickDates, todayIso, type DueBucket } from '../../frontend/src/dates'
export { catalogues, type Messages } from '../../frontend/src/i18n/messages'
export { chooseLanguage, localeOf, type Language } from '../../frontend/src/i18n/language'
