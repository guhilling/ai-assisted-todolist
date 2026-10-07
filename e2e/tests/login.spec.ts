/**
 * End-to-end coverage of the path no other test reaches: a real browser signing in through
 * Keycloak and then using the board.
 *
 * Runs against the containerised stack from deployment/docker/docker-compose.e2e.yml, so it exercises
 * the same httpd proxying and OIDC redirects a deployment would.
 *
 * Each account gets its own `browser.newContext()`. Signing out of the app only expires the
 * backend session cookie -- Keycloak's own SSO session survives it -- so reusing a context
 * would silently sign the second user in as the first.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

const users = {
  gunnar: { username: 'gunnar', password: 'gunnar', email: 'jboss.gunnar@hilling.de', name: 'Gunnar Hilling', initials: 'GH' },
  lasse: { username: 'lasse', password: 'lasse', email: 'lasse@example.com', name: 'Lasse Hilling', initials: 'LH' },
}

/**
 * Signs in through Keycloak.
 *
 * The landing page offers exactly one button, because the frontend shows only providers the
 * backend reports as usable and this stack configures Keycloak alone. Google is declared with
 * no credentials and so is not offered at all.
 */
async function signIn(page: Page, user: (typeof users)[keyof typeof users]) {
  await page.goto('/')
  const signInLink = page.getByRole('link', { name: /sign in with keycloak/i })
  await expect(signInLink).toBeVisible()
  await expect(page.getByRole('link', { name: /about this project/i })).toBeVisible()

  await signInLink.click()

  await page.locator('#username').fill(user.username)
  await page.locator('#password').fill(user.password)
  await page.locator('#kc-login').click()

  // The header shows the display name, not the email: proof that the profile scope survived a
  // real authorization code flow and that the name claim reached the browser.
  await expect(page.getByText(user.name).first()).toBeVisible()
  // Only that an avatar is there. Gunnar's address has a real Gravatar, so his is normally a
  // picture and Lasse's is always initials -- but requiring the picture would make this suite
  // fail whenever gravatar.com is slow or unreachable from CI, and a browser test is the wrong
  // place to depend on a third party. The picture path is pinned down without a network in
  // GravatarServiceTest and in the frontend's own tests.
  await expect(page.locator('.user-avatar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add a task' })).toBeVisible()
}

/** Adds a task through the inline add row, which has to be expanded first. */
async function addTask(page: Page, description: string, dueDate: string, importance = 'MEDIUM') {
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

/** Opens the collapsed completed section and returns the row for `description` inside it. */
async function completedRow(page: Page, description: string): Promise<Locator> {
  const section = page.locator('.completed-section')
  await expect(section).toBeVisible()
  if (!(await section.evaluate((element: HTMLDetailsElement) => element.open))) {
    // A direct child: every row inside also has a <summary> for its own actions menu.
    await section.locator('> summary').click()
  }
  return section.locator('.task-row', { hasText: description })
}

test('signs a local account in through Keycloak and manages its tasks', async ({ page }) => {
  const description = `Ship the Keycloak setup ${Date.now()}`

  await signIn(page, users.gunnar)
  await addTask(page, description, '2026-12-31', 'HIGH')

  const task = page.locator('.task-row', { hasText: description })
  await expect(task).toBeVisible()
  // Importance is a dot now, not a word, so assert the cue rather than visible text.
  await expect(task.locator('.task-importance--high')).toBeVisible()
  await expect(task.getByText('31 Dec')).toBeVisible()

  // The headline interaction: one click finishes the task. The tick is optimistic, so the
  // save has to be waited for explicitly -- the UI says "done" before the server agrees, and
  // reloading while the request is still in flight cancels it. That is exactly what happened
  // against a cold backend, where the first PUT takes seconds rather than milliseconds.
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().includes('/api/tasks/'),
  )
  await page.getByLabel(`Mark "${description}" as done`).check()

  const finished = await completedRow(page, description)
  await expect(finished.getByRole('checkbox')).toBeChecked()

  expect((await saved).ok()).toBe(true)

  // The state change has to survive a round trip through the backend, not just local state.
  await page.reload()
  const afterReload = await completedRow(page, description)
  await expect(afterReload.getByRole('checkbox')).toBeChecked()

  await page.getByRole('link', { name: /sign out/i }).click()
  await expect(page.getByRole('link', { name: /sign in with keycloak/i })).toBeVisible()
})

test('deletes a task for good', async ({ page }) => {
  const description = `Throwaway ${Date.now()}`

  await signIn(page, users.gunnar)
  await addTask(page, description, '2026-12-30')

  const task = page.locator('.task-row', { hasText: description })
  await expect(task).toBeVisible()

  const deleted = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/api/tasks/'),
  )
  await task.getByLabel(`Actions for "${description}"`).click()
  await task.getByRole('button', { name: 'Delete' }).click()
  await expect(task).toHaveCount(0)

  expect((await deleted).ok()).toBe(true)

  // Deleted on the server, not merely dropped from the local list.
  await page.reload()
  await expect(page.locator('.task-row', { hasText: description })).toHaveCount(0)
})

test('edits a task in place and keeps the change', async ({ page }) => {
  const stamp = Date.now()
  const description = `Renew the pasport ${stamp}`
  const corrected = `Renew the passport ${stamp}`

  await signIn(page, users.gunnar)
  await addTask(page, description, '2026-12-28')

  const task = page.locator('.task-row', { hasText: description })
  await task.getByLabel(`Actions for "${description}"`).click()
  await task.getByRole('button', { name: 'Edit' }).click()

  // The row is a form now, named after the task it edits; the add row has fields of the same
  // names, so everything is addressed inside it.
  const editor = page.getByRole('form', { name: `Edit "${description}"` })
  await expect(editor.getByRole('textbox', { name: 'Description' })).toBeFocused()
  await editor.getByRole('textbox', { name: 'Description' }).fill(corrected)
  await editor.getByRole('combobox', { name: 'Importance' }).selectOption('HIGH')

  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().includes('/api/tasks/'),
  )
  await editor.getByRole('button', { name: 'Save' }).click()
  expect((await saved).ok()).toBe(true)

  const edited = page.locator('.task-row', { hasText: corrected })
  await expect(edited.locator('.task-importance--high')).toBeVisible()

  // Saved on the server, not merely shown.
  await page.reload()
  await expect(page.locator('.task-row', { hasText: corrected })).toBeVisible()
  await expect(page.locator('.task-row', { hasText: description })).toHaveCount(0)
})

test('puts a deleted task back when undo is used', async ({ page }) => {
  const description = `Deleted by mistake ${Date.now()}`

  await signIn(page, users.gunnar)
  await addTask(page, description, '2026-12-29')

  const task = page.locator('.task-row', { hasText: description })
  await expect(task).toBeVisible()

  const deleted = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && response.url().includes('/api/tasks/'),
  )
  await task.getByLabel(`Actions for "${description}"`).click()
  await task.getByRole('button', { name: 'Delete' }).click()
  await expect(task).toHaveCount(0)
  expect((await deleted).ok()).toBe(true)

  // Restoring re-creates the task, so wait for that rather than the disappearance of the row.
  const restored = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/api/tasks'),
  )
  await page.getByRole('button', { name: 'Undo' }).click()
  expect((await restored).ok()).toBe(true)

  await expect(page.locator('.task-row', { hasText: description })).toBeVisible()

  // Back on the server, not merely back on screen -- with a new id, which is invisible here.
  await page.reload()
  await expect(page.locator('.task-row', { hasText: description })).toBeVisible()
})

test('keeps the two local accounts from seeing each other tasks', async ({ browser }) => {
  const description = `Only for gunnar ${Date.now()}`

  // Signing out only clears the application's own session cookie -- Keycloak keeps its SSO
  // session, so a second user needs a browser context of its own rather than a sign-out.
  const gunnarContext = await browser.newContext()
  const gunnarPage = await gunnarContext.newPage()
  await signIn(gunnarPage, users.gunnar)
  await addTask(gunnarPage, description, '2026-11-30')
  await expect(gunnarPage.locator('.task-row', { hasText: description })).toBeVisible()
  await gunnarContext.close()

  const lasseContext = await browser.newContext()
  const lassePage = await lasseContext.newPage()
  await signIn(lassePage, users.lasse)
  // Deterministic: example.com is reserved, so this address can never acquire a Gravatar, which
  // makes it the one account whose initials fallback is safe to assert in CI.
  await expect(lassePage.locator('.user-avatar--initials')).toHaveText(users.lasse.initials)
  await expect(lassePage.locator('.task-row', { hasText: description })).toHaveCount(0)
  await lasseContext.close()
})
