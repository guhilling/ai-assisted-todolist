/**
 * Driving the board the way a person does, shared by the end-to-end scenarios (tests/login.spec.ts,
 * tests/attachments.spec.ts and tests/thumbnails.spec.ts), so the add row's interaction, and opening
 * a file, are written down once.
 */
import { readFile } from 'node:fs/promises'
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
 * Opens a file from its task's row in its large preview (#586), saves it with the preview's
 * Download, and closes the preview again. Returns what was saved and the signed link the preview
 * showed the file through -- the photo's, the PDF viewer's, or, where the browser shows no PDF
 * inside the page, the link to open it in a new tab.
 */
export async function openFile(page: Page, row: Locator, name: string) {
  await row.getByRole('button', { name: `Open ${name}` }).click()
  const preview = page.getByRole('dialog', { name })
  const shown = preview.locator('img, iframe, a[target="_blank"]').first()
  await shown.waitFor()
  const link = (await shown.getAttribute('src')) ?? (await shown.getAttribute('href')) ?? ''
  const downloaded = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'Download' }).click()
  const download = await downloaded
  const path = await download.path()
  const saved = { name: download.suggestedFilename(), bytes: await readFile(path), link }
  await preview.getByRole('button', { name: 'Close' }).click()
  return saved
}
