/**
 * End-to-end coverage of the path no other test reaches: a real browser signing in through
 * Keycloak and then using the board.
 *
 * Runs against the containerised stack from docker/docker-compose.e2e.yml, so it exercises
 * the same nginx proxying and OIDC redirects a deployment would.
 *
 * Each account gets its own `browser.newContext()`. Signing out of the app only expires the
 * backend session cookie -- Keycloak's own SSO session survives it -- so reusing a context
 * would silently sign the second user in as the first.
 */
import { expect, test, type Page } from '@playwright/test'

const users = {
  gunnar: { username: 'gunnar', password: 'gunnar', email: 'gunnar@example.com' },
  lasse: { username: 'lasse', password: 'lasse', email: 'lasse@example.com' },
}

async function signIn(page: Page, user: (typeof users)[keyof typeof users]) {
  await page.goto('/')
  await expect(page.getByText('Please sign in to continue.')).toBeVisible()

  await page.getByRole('link', { name: /continue with keycloak/i }).click()

  await page.locator('#username').fill(user.username)
  await page.locator('#password').fill(user.password)
  await page.locator('#kc-login').click()

  await expect(page.getByText(user.email).first()).toBeVisible()
}

test('signs a local account in through Keycloak and manages its tasks', async ({ page }) => {
  const description = `Ship the Keycloak setup ${Date.now()}`

  await signIn(page, users.gunnar)
  await expect(page.getByRole('heading', { name: /current tasks/i })).toBeVisible()

  await page.getByLabel('Description').fill(description)
  await page.getByLabel('Due date').fill('2026-12-31')
  await page.getByLabel('Importance').selectOption('HIGH')
  await page.getByRole('button', { name: /create task/i }).click()

  const task = page.locator('.todo-card', { hasText: description })
  await expect(task).toBeVisible()
  await expect(task.getByText('Importance: HIGH')).toBeVisible()

  await task.getByLabel('Update state').selectOption('DONE')
  await expect(task.getByLabel('Update state')).toHaveValue('DONE')

  // The state change has to survive a round trip through the backend, not just the local state.
  await page.reload()
  await expect(page.locator('.todo-card', { hasText: description }).getByLabel('Update state')).toHaveValue('DONE')

  await page.getByRole('link', { name: /sign out/i }).click()
  await expect(page.getByText('Please sign in to continue.')).toBeVisible()
})

test('keeps the two local accounts from seeing each other tasks', async ({ browser }) => {
  const description = `Only for gunnar ${Date.now()}`

  // Signing out only clears the application's own session cookie -- Keycloak keeps its SSO
  // session, so a second user needs a browser context of its own rather than a sign-out.
  const gunnarContext = await browser.newContext()
  const gunnarPage = await gunnarContext.newPage()
  await signIn(gunnarPage, users.gunnar)
  await gunnarPage.getByLabel('Description').fill(description)
  await gunnarPage.getByLabel('Due date').fill('2026-11-30')
  await gunnarPage.getByRole('button', { name: /create task/i }).click()
  await expect(gunnarPage.locator('.todo-card', { hasText: description })).toBeVisible()
  await gunnarContext.close()

  const lasseContext = await browser.newContext()
  const lassePage = await lasseContext.newPage()
  await signIn(lassePage, users.lasse)
  await expect(lassePage.getByRole('heading', { name: /current tasks/i })).toBeVisible()
  await expect(lassePage.locator('.todo-card', { hasText: description })).toHaveCount(0)
  await lasseContext.close()
})
