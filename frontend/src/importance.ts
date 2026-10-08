import type { Task, TaskImportance } from './api'
import { en } from './i18n/messages'

/**
 * The importance levels' English words, for the design system's consumers.
 *
 * The app itself words them in the visitor's language, from `messages.importance.levels` (#203);
 * this is that catalogue's English entry, not a second copy of it. The levels are a `Record` over
 * the generated `TaskImportance`, so a level the backend adds is a compile error in the catalogue
 * instead of an option silently missing from every picker.
 */
export const importanceLabels: Record<TaskImportance, string> = en.importance.levels

/**
 * The levels in the order a picker offers them, least important first. Only that: the board's
 * order comes from `importanceRank`, so rearranging a picker never rearranges the board.
 */
export const importanceLevels = Object.keys(importanceLabels) as TaskImportance[]

/**
 * How much each level outranks the others, highest first on the board (#217). Stated here rather
 * than taken from any list kept for another purpose, so it changes only on purpose.
 */
export const importanceRank: Record<TaskImportance, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }

/** Within a day: what matters most first, then creation order, so alike tasks never reshuffle. */
function compareWithinADay(left: Task, right: Task) {
  return importanceRank[right.importance] - importanceRank[left.importance] || left.id - right.id
}

/** Open tasks: by due date, soonest first, then within a day as above. */
export function compareOpen(left: Task, right: Task) {
  return left.dueDate.localeCompare(right.dueDate) || compareWithinADay(left, right)
}

/** Completed tasks: most recently due first, then within a day as open ones are. */
export function compareCompleted(left: Task, right: Task) {
  return right.dueDate.localeCompare(left.dueDate) || compareWithinADay(left, right)
}
