import { defineConfig, devices } from '@playwright/test'

/**
 * Clears qa's test accounts, and nothing else: for the app's live run (#278), which signs in as
 * them on the emulator and leaves its tasks behind (live/clear-test-accounts.task.ts). Needs the
 * passwords the live-test job has just set, in E2E_PASSWORD_ONE and E2E_PASSWORD_TWO, and
 * E2E_IDENTITY=cognito.
 *
 * Nothing recorded, no report: a trace would carry the typed passwords, and the clearing's own
 * output says what it cleared.
 */
export default defineConfig({
  testDir: './live',
  testMatch: 'clear-test-accounts.task.ts',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? 'https://taskfest-qa.cloud.hilling.de',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'live-clear', use: { ...devices['Desktop Chrome'] } }],
})
