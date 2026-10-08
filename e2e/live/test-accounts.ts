/**
 * Clears qa's test accounts before and after a signed-in run (#144): every task they have is
 * deleted, so qa never fills up with test data -- and every file on them removed first (#204).
 * Deleting a task only detaches its files for the ten-minute undo window, and they count toward
 * the five files a user may have until then; two aborted runs in a row would otherwise make the
 * next one fail on that limit rather than on whatever went wrong.
 *
 * The accounts exist for nothing else, so deleting all of their tasks is safe; and because it also
 * runs before, a run that was aborted half-way is cleaned up by the next one. Skipped while the
 * environment is down -- there is nothing to reach.
 */
import { chromium, expect, type FullConfig } from '@playwright/test'
import { currentIdentity, signInAs } from '../support/identity'

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
      await signInAs(page, identity, account)

      const headers = { 'X-Requested-With': 'JavaScript' }
      const listed = await page.request.get('/api/tasks', { headers })
      expect(listed.status(), `listing the tasks of ${account.email}`).toBe(200)
      const tasks: unknown = await listed.json()
      if (!Array.isArray(tasks)) {
        throw new Error(`listing the tasks of ${account.email} returned no list: ${JSON.stringify(tasks)}`)
      }
      for (const task of tasks) {
        // Only available files are listed; an upload a run abandoned half way is swept within the hour.
        for (const attachment of task.attachments ?? []) {
          const removed = await page.request.delete(`/api/tasks/${task.id}/attachments/${attachment.id}`, { headers })
          expect(removed.ok(), `removing attachment ${attachment.id} of ${account.email}`).toBe(true)
        }
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
