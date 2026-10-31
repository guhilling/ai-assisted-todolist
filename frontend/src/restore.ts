import type { TaskCreateRequest, TaskResponse } from './generated/types'

/**
 * How a deleted task is put back (#204, #271): the website's undo and the mobile app's use this
 * one rule, each with its own requests.
 *
 * Creating refuses a date that is past everywhere, so a task already overdue when it was deleted is created
 * dated today and then dated back by an update, which does allow one -- otherwise undo would fail
 * for exactly the tasks people delete most, the old ones. Its files were only detached by the
 * delete, and come back with it within the undo window.
 */
export function restoreInput(task: TaskResponse, today: string): TaskCreateRequest {
  const input: TaskCreateRequest = {
    description: task.description,
    dueDate: task.dueDate < today ? today : task.dueDate,
    importance: task.importance,
    state: task.state,
  }
  if (task.attachments && task.attachments.length > 0) {
    input.attachmentIds = task.attachments.map((attachment) => attachment.id)
  }
  return input
}

/** Whether the task created by {@link restoreInput} still has to be dated back to the deleted one's day. */
export function needsDatingBack(created: TaskResponse, deleted: TaskResponse) {
  return created.dueDate !== deleted.dueDate
}

/**
 * An undo that re-created the task but could not date it back to the deleted one's day (#426).
 * The task exists, dated today, so it carries the task for the board to show -- one that exists
 * unseen is worse than one with the wrong date -- and why the date could not be put back. The
 * website's undo and the app's both throw it.
 */
export class NotDatedBackError extends Error {
  readonly task: TaskResponse

  constructor(task: TaskResponse, cause: unknown) {
    super('The task was restored, but not to its own date.', { cause })
    this.name = 'NotDatedBackError'
    this.task = task
  }
}
