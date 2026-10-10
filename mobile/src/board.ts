import { bucketOf, compareCompleted, compareOpen, type DueBucket, type Task } from './web'

/** The dated sections, in the order the website shows them; completed tasks are kept apart. */
const BUCKETS: DueBucket[] = ['overdue', 'today', 'tomorrow', 'thisWeek', 'later']

/** One dated section of the board: its bucket names its title in the catalogue. */
export type Section = { bucket: DueBucket; tasks: Task[] }

/** The board as the app shows it: what is open, by when it is due, and what is done. */
export type Board = { sections: Section[]; completed: Task[] }

/**
 * Arranges tasks the way the website's board does (#267): open tasks in dated sections, soonest
 * first and by importance within a day, and completed ones apart, most recently due first. The
 * order is the website's own (`compareOpen`, `compareCompleted`), so the two never disagree.
 * Unlike the website, an empty section is left out: on a phone it is only a heading in the way.
 */
export function boardOf(tasks: Task[], today: string): Board {
  const open = tasks.filter((task) => task.state !== 'DONE').sort(compareOpen)
  const sections = BUCKETS.map((bucket) => ({
    bucket,
    tasks: open.filter((task) => bucketOf(task.dueDate, today) === bucket),
  })).filter((section) => section.tasks.length > 0)
  const completed = tasks.filter((task) => task.state === 'DONE').sort(compareCompleted)
  return { sections, completed }
}
