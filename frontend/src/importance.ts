import type { TaskImportance } from './api'
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

/** The levels in the order a picker offers them, least important first. */
export const importanceLevels = Object.keys(importanceLabels) as TaskImportance[]
