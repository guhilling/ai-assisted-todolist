/**
 * The library entry: the board's components, packaged for use outside this application.
 *
 * It exists so the pieces under `components/` can be bundled and rendered somewhere that is
 * not this app -- a design tool, a documentation site -- without dragging the app shell along.
 * The components were already written to suit it: they take callbacks and data, none of them
 * fetches, and `SignedOut` takes the API base URL as a prop rather than importing the wire.
 *
 * The stylesheets are imported here rather than left to the consumer, because a component
 * whose class names resolve to nothing is not a component anyone can use. `index.css` carries
 * the colour scheme and the resets; `App.css` carries the tokens and the class vocabulary.
 */
import './index.css'
import './App.css'

export { default as AddTaskRow } from './components/AddTaskRow'
export { default as CalendarPanel } from './components/CalendarPanel'
export { default as CompletedSection } from './components/CompletedSection'
export { default as DueDateField } from './components/DueDateField'
export { default as Paused } from './components/Paused'
export { default as SignedOut, purposeUrl } from './components/SignedOut'
export { default as TaskEditor } from './components/TaskEditor'
export type { TaskEdit } from './components/TaskEditor'
export { default as TaskRow } from './components/TaskRow'
export { default as TaskSection } from './components/TaskSection'
export { default as UndoToast } from './components/UndoToast'
export { default as UserAvatar } from './components/UserAvatar'

/** The due-date words and arithmetic the rows render. Pure, and every function takes today. */
export { addDays, bucketOf, daysBetween, describeDueDate, quickDates, todayIso } from './dates'
export type { DueBucket } from './dates'

/** The importance levels and the word each one reads as. */
export { importanceLabels, importanceLevels } from './importance'

/** The shapes the components take, generated from the backend's published JSON Schemas. */
export type {
  AuthProvider,
  AuthProvidersResponse,
  CurrentUser,
  Task,
  TaskImportance,
  TaskInput,
  TaskState,
} from './api'
