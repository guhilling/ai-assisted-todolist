/**
 * End-to-end coverage of the path no other test reaches: a real browser signing in and then using
 * the board.
 *
 * Runs against the containerised stack from deployment/docker/docker-compose.e2e.yml with the local
 * Keycloak accounts, so it exercises the same httpd proxying and OIDC redirects a deployment would --
 * and, unchanged, against qa with its Cognito test accounts (#144): support/identity.ts holds
 * everything that differs. Against an environment that is down, it skips.
 *
 * Each account gets its own `browser.newContext()`. Signing out of the app only expires the
 * backend session cookie -- the provider's own session survives it -- so reusing a context
 * would silently sign the second user in as the first.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { currentIdentity, signInAs, type Account } from '../support/identity'

const identity = currentIdentity()

/**
 * A due date this many days from today, as the date field takes it. Never a fixed date: the backend
 * refuses one in the past, so a fixed date fails every run once it has gone by -- and these
 * scenarios now run after every deploy to qa.
 */
function inDays(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** How the board words a due date a week or more away: frontend/src/dates.ts, `describeDueDate`. */
function shownAs(iso: string) {
  const sameYear = iso.slice(0, 4) === new Date().toISOString().slice(0, 4)
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

// Set by e2e/live/backend-state.ts for a live run; never set against the Compose stack.
test.skip(() => process.env.LIVE_BACKEND_DOWN === '1', 'the environment is down')

/**
 * Signs in through the identity's provider.
 *
 * Against the Compose stack the landing page offers exactly one button, because the frontend shows
 * only providers the backend reports as usable and that stack configures Keycloak alone; in qa it
 * offers Google beside the test accounts, and this clicks the latter.
 */
async function signIn(page: Page, user: Account) {
  await page.goto('/')
  await expect(page.getByRole('link', { name: /^about/i })).toBeVisible()
  await signInAs(page, identity, user)

  // The header shows the display name, not the email: proof that the profile scope survived a
  // real authorization code flow and that the name claim reached the browser.
  await expect(page.getByText(user.name).first()).toBeVisible()
  // Only that an avatar is there. Every account here has a reserved example.com address, so it is
  // initials -- and a browser test is the wrong place to depend on gravatar.com anyway. The picture
  // path is pinned down without a network in GravatarServiceTest and in the frontend's own tests.
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

test('signs an account in and manages its tasks', async ({ page }) => {
  const description = `Ship the sign-in setup ${Date.now()}`

  await signIn(page, identity.primary)
  const due = inDays(60)
  await addTask(page, description, due, 'HIGH')

  const task = page.locator('.task-row', { hasText: description })
  await expect(task).toBeVisible()
  // Importance is a dot now, not a word, so assert the cue rather than visible text.
  await expect(task.locator('.task-importance--high')).toBeVisible()
  await expect(task.getByText(shownAs(due))).toBeVisible()

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
  await expect(page.getByRole('link', { name: identity.button })).toBeVisible()
})

test('deletes a task for good', async ({ page }) => {
  const description = `Throwaway ${Date.now()}`

  await signIn(page, identity.primary)
  await addTask(page, description, inDays(59))

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

  await signIn(page, identity.primary)
  await addTask(page, description, inDays(57))

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

  await signIn(page, identity.primary)
  await addTask(page, description, inDays(58))

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

test('keeps the two accounts from seeing each other tasks', async ({ browser }) => {
  const description = `Only for the first account ${Date.now()}`

  // Signing out only clears the application's own session cookie -- the provider keeps its own
  // session, so a second user needs a browser context of its own rather than a sign-out.
  const firstContext = await browser.newContext()
  const firstPage = await firstContext.newPage()
  await signIn(firstPage, identity.primary)
  await addTask(firstPage, description, inDays(54))
  await expect(firstPage.locator('.task-row', { hasText: description })).toBeVisible()
  await firstContext.close()

  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  await signIn(secondPage, identity.secondary)
  // Deterministic: example.com is reserved, so this address can never acquire a Gravatar, which
  // makes it the account whose initials fallback is safe to assert -- locally and in qa alike.
  await expect(secondPage.locator('.user-avatar--initials')).toHaveText(identity.secondary.initials)
  await expect(secondPage.locator('.task-row', { hasText: description })).toHaveCount(0)
  await secondContext.close()
})

test('serves each account its own task list, never from a cache', async ({ browser }) => {
  // Only CloudFront says whether it served an answer from its cache, and only a live run -- one
  // against a deployed environment, LIVE_BASE_URL -- goes through it; the Compose stack has none.
  test.skip(!process.env.LIVE_BASE_URL, 'only a deployed environment sits behind CloudFront')
  const description = `Not for the second account ${Date.now()}`
  const tasksOf = async (page: Page) => {
    const response = await page.request.get('/api/tasks', { headers: { 'X-Requested-With': 'JavaScript' } })
    expect(response.status()).toBe(200)
    expect(response.headers()['x-cache']).toBe('Miss from cloudfront')
    return response.text()
  }

  const firstContext = await browser.newContext()
  const firstPage = await firstContext.newPage()
  await signIn(firstPage, identity.primary)
  await addTask(firstPage, description, inDays(53))
  await expect(firstPage.locator('.task-row', { hasText: description })).toBeVisible()
  expect(await tasksOf(firstPage)).toContain(description)

  // The same URL, straight after, for someone else: a cache keyed on the URL alone would hand the
  // first account's list over here.
  const secondContext = await browser.newContext()
  const secondPage = await secondContext.newPage()
  await signIn(secondPage, identity.secondary)
  expect(await tasksOf(secondPage)).not.toContain(description)

  await firstContext.close()
  await secondContext.close()
})

