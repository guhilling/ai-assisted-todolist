/**
 * Driving the board the way a person does, shared by the end-to-end scenarios (tests/login.spec.ts,
 * tests/attachments.spec.ts and tests/thumbnails.spec.ts), so the add row's interaction, and opening
 * a file, are written down once.
 */
import type { Locator, Page } from '@playwright/test'

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

/**
 * Opens a file from its task's row, which the board does in a new tab pointed at a signed link,
 * and returns that link. The tab is closed again once it is done with the file: closed while a
 * large photo was still arriving, it once hung in Chromium (#485). Done means the photo's answer
 * has come in whole, or, for a PDF, which a headless browser downloads rather than shows and whose
 * answer then never finishes, that the download has started. And closed at once, because the live
 * run records every tab and publishes the largest video as the scenario's (doc/testing/live.md).
 */
export async function openFile(page: Page, row: Locator, name: string) {
  const popup = page.waitForEvent('popup')
  const opened = page.context().waitForEvent(
    'request',
    (request) => request.url().includes('X-Amz-Signature') && request.resourceType() === 'document',
  )
  await row.getByRole('button', { name: `Open ${name}` }).click()
  // The tab opens on the click and is pointed at the link only once the board has it, so the
  // download cannot have started before this waits for it.
  const tab = await popup
  const downloaded = tab.waitForEvent('download').catch(() => undefined)
  const request = await opened
  await Promise.race([request.response().then((response) => response?.finished()), downloaded])
  await tab.close()
  return request.url()
}
