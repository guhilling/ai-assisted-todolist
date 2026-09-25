import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for the browser end-to-end suite.
 *
 * There is deliberately no `webServer` block: the stack is owned by
 * docker/docker-compose.e2e.yml, so bring the containers up first and run these tests
 * against them. The suite is serial because the tests share one PostgreSQL database.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
