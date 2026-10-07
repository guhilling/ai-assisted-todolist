import { defineConfig, devices } from '@playwright/test'

// The only identity a deployed environment has; set here, so a run without it does not go looking
// for a Keycloak button on qa.
process.env.E2E_IDENTITY ??= 'cognito'
// And a live run, which is what tells the scenarios that CloudFront is in front of them.
process.env.LIVE_BASE_URL ??= 'https://taskfest-qa.cloud.hilling.de'

/**
 * The signed-in scenarios (tests/login.spec.ts) against a deployed environment, with its test
 * accounts (#144).
 *
 * The same tests the Compose suite runs, signed in as qa's Cognito test accounts instead of the local
 * Keycloak ones: E2E_IDENTITY=cognito, and the passwords the live-test job has just set, in
 * E2E_PASSWORD_ONE and E2E_PASSWORD_TWO. Before and after, the accounts' tasks are cleared; while the
 * environment is down, everything skips (live/backend-state.ts).
 *
 * Serial, as against the Compose stack: the scenarios share the two accounts. No retries, for the
 * same reason as the smoke checks -- a flaky live run is a finding.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: ['./live/backend-state.ts', './live/test-accounts.ts'],
  globalTeardown: './live/test-accounts.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never', outputFolder: 'playwright-report-live-signed-in' }], ['list']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env.LIVE_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'live-signed-in', use: { ...devices['Desktop Chrome'] } }],
})
