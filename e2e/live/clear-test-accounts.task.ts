/**
 * Clears qa's test accounts on its own, for the app's live run (#278): the same clearing the
 * website's signed-in scenarios do before and after themselves (test-accounts.ts), run before and
 * after the app's flows by mobile/maestro/live/run-on-qa.sh. Not a `.spec.ts`, so the smoke checks,
 * which run everything in this folder, never pick it up.
 */
import { test } from '@playwright/test'
import clearTestAccounts from './test-accounts'

test('clears the test accounts', async () => {
  await clearTestAccounts(test.info().config)
})
