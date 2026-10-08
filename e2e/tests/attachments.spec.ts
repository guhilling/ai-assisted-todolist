/**
 * Files on a task (#204), in a real browser against real storage: attach a PDF and an image in the
 * editor, see the image inline, open the PDF, remove both.
 *
 * What only this can show is the browser's own path to S3, which the backend never sees: the PUT
 * to a presigned link (a cross-origin request the bucket's CORS rule must allow, with the size and
 * type it was signed for) and the GET an inline image and an opened file make. Against the Compose
 * stack S3 is LocalStack with signature checks on; run unchanged against qa with its test accounts
 * (#144), it is the environment's real bucket. The scenario removes what it attached; if it fails
 * half way, the live run's teardown deletes the task, and the attachment sweep its files.
 */
import { expect, test, type Page } from '@playwright/test'
import { currentIdentity, signInAs } from '../support/identity'

const identity = currentIdentity()

// Set by e2e/live/backend-state.ts for a live run; never set against the Compose stack.
test.skip(() => process.env.LIVE_BACKEND_DOWN === '1', 'the environment is down')

/** A small but real PDF, so what comes back can be compared byte for byte. */
const PDF = Buffer.from('%PDF-1.4\n% TaskFest end-to-end attachment\n%%EOF\n')

/** A 1x1 PNG: an image a browser can actually decode, so its preview has a width. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Tomorrow, as the date field takes it: never a fixed date, which would fall into the past. */
function tomorrow() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function addTask(page: Page, description: string) {
  await page.getByRole('button', { name: 'Add a task' }).click()
  await page.getByLabel('What needs doing').fill(description)
  await page.getByRole('textbox', { name: 'Due date' }).fill(tomorrow())
  await page.getByRole('button', { name: 'Add', exact: true }).click()
}

test('attaches a PDF and an image, opens them, and removes them', async ({ page }) => {
  await page.goto('/')
  await signInAs(page, identity, identity.primary)
  await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible()

  // Unique per run, since qa keeps the accounts between runs.
  const description = `File the invoice ${Date.now()}`
  await addTask(page, description)
  const row = page.locator('.task-row', { hasText: description })
  await expect(row).toBeVisible()

  await row.getByLabel(`Actions for "${description}"`).click()
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.getByRole('form', { name: `Edit "${description}"` })
  await expect(editor.getByText(/PDF or image, up to 10 MB/)).toBeVisible()

  // The upload: announce, a PUT straight to storage, confirm. A refused PUT -- CORS, or a signature
  // that does not match -- shows as "could not be uploaded" instead of the remove button.
  await editor.getByLabel('choose a file').setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: PDF })
  await expect(editor.getByRole('button', { name: 'Remove invoice.pdf' })).toBeVisible()
  await editor.getByLabel('choose a file').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG })
  await expect(editor.getByRole('button', { name: 'Remove receipt.png' })).toBeVisible()
  await editor.getByRole('button', { name: 'Cancel' }).click()

  // The image is shown inline: the browser fetched and decoded it from storage.
  const preview = row.getByRole('img', { name: 'receipt.png' })
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)

  // Opening the PDF points a new tab at a signed link. A headless browser downloads a PDF rather
  // than showing it, so the link is taken from the tab's request and fetched to compare the bytes.
  const opened = page.context().waitForEvent(
    'request',
    (request) => request.url().includes('X-Amz-Signature') && request.resourceType() === 'document',
  )
  await row.getByRole('button', { name: 'Open invoice.pdf' }).click()
  const link = (await opened).url()
  const fetched = await page.request.get(link)
  expect(fetched.status()).toBe(200)
  expect(Buffer.from(await fetched.body())).toEqual(PDF)
  for (const tab of page.context().pages().filter((other) => other !== page)) {
    await tab.close()
  }

  await row.getByRole('button', { name: 'Remove invoice.pdf' }).click()
  await row.getByRole('button', { name: 'Remove receipt.png' }).click()
  await expect(row.getByRole('button', { name: /^Open / })).toHaveCount(0)

  // Gone on the server too, not only from the board's state.
  await page.reload()
  const reloaded = page.locator('.task-row', { hasText: description })
  await expect(reloaded).toBeVisible()
  await expect(reloaded.getByRole('button', { name: /^Open / })).toHaveCount(0)

  // Tidy: the task itself goes as well, so neither the Compose database nor qa's accounts fill up.
  // The row disappears before the request is sent, so the test waits for the server's answer;
  // ending first would close the page and cancel the DELETE.
  await reloaded.getByLabel(`Actions for "${description}"`).click()
  const deleted = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/api/tasks/'),
  )
  await reloaded.getByRole('button', { name: 'Delete' }).click()
  expect((await deleted).ok()).toBe(true)
  await expect(page.locator('.task-row', { hasText: description })).toHaveCount(0)
})
