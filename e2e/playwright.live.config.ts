import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the live checks against a deployed environment (#141, #142).
 *
 * A separate configuration rather than a project in playwright.config.ts, so the Compose suite
 * and its workflow stay exactly as they are: `npx playwright test` still runs only that one.
 * These run against the real thing -- CloudFront, the load balancer, ECS -- and need no
 * credentials, because nothing here signs in.
 *
 * No retries, on purpose: a live check that passes on the second try has found something
 * flaky in the environment, and that is worth a red run.
 */
export default defineConfig({
  testDir: './live',
  globalSetup: './live/backend-state.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never', outputFolder: 'playwright-report-live' }], ['list']] : 'list',
  timeout: 30_000,
  use: {
    baseURL: process.env.LIVE_BASE_URL ?? 'https://taskfest-qa.cloud.hilling.de',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'live-smoke', use: { ...devices['Desktop Chrome'] } }],
})
