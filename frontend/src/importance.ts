import type { TaskImportance } from './api'

/**
 * The importance levels and the word each one reads as.
 *
 * A `Record` over the generated `TaskImportance` rather than a hand-written list, so a level the
 * backend adds is a compile error here instead of an option silently missing from every picker.
 * The row renders the word for screen readers; the add and edit forms offer it as the option.
 */
export const importanceLabels: Record<TaskImportance, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
}

/** The levels in the order a picker offers them, least important first. */
export const importanceLevels = Object.keys(importanceLabels) as TaskImportance[]
