/**
 * The `n` badge on Add a task (#386): shown where a precise pointer suggests a keyboard, not on a
 * phone. Only a real browser applies the media query, so this is the check. The Compose suite only:
 * the live run leaves it out (playwright.live-signed-in.config.ts).
 */
import { devices, expect, test } from '@playwright/test'
import { currentIdentity, signInAs } from '../support/identity'

const identity = currentIdentity()

// Set by e2e/live/backend-state.ts for a live run; never set against the Compose stack.
test.skip(() => process.env.LIVE_BACKEND_DOWN === '1', 'the environment is down')

test('shows the n badge on a desktop', async ({ page }) => {
  await signInAs(page, identity, identity.primary)

  await expect(page.locator('.add-row-key')).toBeVisible()
})

test.describe('on a phone', () => {
  // A touch screen and nothing finer: Chromium's phone emulation reports any-pointer: coarse, as a
  // phone does.
  const { defaultBrowserType: _browser, ...phone } = devices['Pixel 7']
  test.use(phone)

  test('leaves the n badge out', async ({ page }) => {
    await signInAs(page, identity, identity.primary)

    // There, and hidden by the stylesheet: not merely gone under another name.
    await expect(page.locator('.add-row-key')).toHaveCount(1)
    await expect(page.locator('.add-row-key')).toHaveCSS('display', 'none')
  })
})
