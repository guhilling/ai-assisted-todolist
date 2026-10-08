/**
 * Preview thumbnails (#236), in a real browser against real storage: attaching a photo makes a
 * small JPEG of it in the browser's canvas, uploads it next to the photo, and the row shows that
 * instead of the photo itself -- a few kilobytes instead of megabytes on every board load.
 *
 * jsdom has no canvas, so only a real browser makes a real thumbnail; the unit tests stub one. Like
 * attachments.spec.ts it runs against LocalStack in the Compose stack and against qa's real bucket
 * in a live run, and removes what it attached.
 */
import { expect, test } from '@playwright/test'
import { addTask, inDays } from '../support/board'
import { currentIdentity, signInAs } from '../support/identity'

const identity = currentIdentity()

// Set by e2e/live/backend-state.ts for a live run; never set against the Compose stack.
test.skip(() => process.env.LIVE_BACKEND_DOWN === '1', 'the environment is down')

/** A photo large enough to be scaled down: a canvas-drawn 1600 x 1200 PNG, made in the page. */
async function photo(page: import('@playwright/test').Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 1200
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, 1600, 1200)
    gradient.addColorStop(0, '#2a6')
    gradient.addColorStop(1, '#36c')
    context.fillStyle = gradient
    context.fillRect(0, 0, 1600, 1200)
    return canvas.toDataURL('image/png')
  })
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

test('shows a photo on its row by a thumbnail the browser made', async ({ page }) => {
  await page.goto('/')
  await signInAs(page, identity, identity.primary)
  await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible()

  const description = `Holiday photo ${Date.now()}`
  await addTask(page, description, inDays(1))
  const row = page.locator('.task-row', { hasText: description })
  await row.getByLabel(`Actions for "${description}"`).click()
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const editor = page.getByRole('form', { name: `Edit "${description}"` })
  await editor.getByLabel('choose a file').setInputFiles({ name: 'beach.png', mimeType: 'image/png', buffer: await photo(page) })
  await expect(editor.getByRole('button', { name: 'Remove beach.png' })).toBeVisible()
  await editor.getByRole('button', { name: 'Cancel' }).click()

  // The row shows the thumbnail: scaled to 128 px on its shorter side, not the 1600 x 1200 original.
  const preview = row.getByRole('img', { name: 'beach.png' })
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalHeight)).toBe(128)
  expect(await preview.getAttribute('src')).toContain('.thumbnail')

  // Opening it still opens the photo itself.
  const opened = page.context().waitForEvent(
    'request',
    (request) => request.url().includes('X-Amz-Signature') && request.resourceType() === 'document',
  )
  await row.getByRole('button', { name: 'Open beach.png' }).click()
  expect((await opened).url()).not.toContain('.thumbnail')
  for (const tab of page.context().pages().filter((other) => other !== page)) {
    await tab.close()
  }

  // Tidy, as attachments.spec.ts does: the file, then the task, waiting for the server's answer.
  await row.getByRole('button', { name: 'Remove beach.png' }).click()
  await expect(row.getByRole('button', { name: /^Open / })).toHaveCount(0)
  await row.getByLabel(`Actions for "${description}"`).click()
  const deleted = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/api/tasks/'),
  )
  await row.getByRole('button', { name: 'Delete' }).click()
  expect((await deleted).ok()).toBe(true)
})
