import type { TaskCreateRequest, TaskResponse } from './generated/types'

/**
 * How a deleted task is put back (#204, #271): the website's undo and the mobile app's use this
 * one rule, each with its own requests.
 *
 * Creating refuses a date in the past, so a task already overdue when it was deleted is created
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
