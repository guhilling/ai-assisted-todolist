/**
 * Driving the board the way a person does, shared by the end-to-end scenarios (tests/login.spec.ts
 * and tests/attachments.spec.ts), so the add row's interaction is written down once.
 */
import type { Page } from '@playwright/test'

/**
 * A due date this many days from today, as the date field takes it. Never a fixed date: the backend
 * refuses one in the past, so a fixed date fails every run once it has gone by -- and these
 * scenarios now run after every deploy to qa.
 */
export function inDays(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Adds a task through the inline add row, which has to be expanded first. */
export async function addTask(page: Page, description: string, dueDate: string, importance = 'MEDIUM') {
  await page.getByRole('button', { name: 'Add a task' }).click()
  await page.getByLabel('What needs doing').fill(description)
  // Addressed by role and accessible name rather than by label text. getByLabel matches
  // substrings, so "Due date" also hits the "Due date shortcuts" group; and with exact it
  // misses the select entirely, because a wrapping label's text content swallows the option
  // labels ("ImportanceLowMediumHigh"). The accessible name is the thing worth asserting.
  await page.getByRole('textbox', { name: 'Due date' }).fill(dueDate)
  await page.getByRole('combobox', { name: 'Importance' }).selectOption(importance)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
}
