/**
 * Clears qa's test accounts before and after a signed-in run (#144): every task they have is
 * deleted, so qa never fills up with test data.
 *
 * The accounts exist for nothing else, so deleting all of their tasks is safe; and because it also
 * runs before, a run that was aborted half-way is cleaned up by the next one. Skipped while the
 * environment is down -- there is nothing to reach.
 */
import { chromium, expect, type FullConfig } from '@playwright/test'
import { currentIdentity } from '../support/identity'

export default async function clearTestAccounts(config: FullConfig) {
  if (process.env.LIVE_BACKEND_DOWN === '1') {
    return
  }
  const identity = currentIdentity()
  const baseURL = config.projects[0].use.baseURL
  const browser = await chromium.launch()
  try {
    for (const account of [identity.primary, identity.secondary]) {
      const context = await browser.newContext({ baseURL })
      const page = await context.newPage()
      await page.goto('/')
      await page.getByRole('link', { name: identity.button }).click()
      await identity.fillLoginForm(page, account)
      await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible({ timeout: 30_000 })

      const headers = { 'X-Requested-With': 'JavaScript' }
      const tasks: { id: number }[] = await (await page.request.get('/api/tasks', { headers })).json()
      for (const task of tasks) {
        const deleted = await page.request.delete(`/api/tasks/${task.id}`, { headers })
        expect(deleted.ok(), `deleting task ${task.id} of ${account.email}`).toBe(true)
      }
      console.log(`${account.email}: ${tasks.length} task(s) cleared`)
      await context.close()
    }
  } finally {
    await browser.close()
  }
}
