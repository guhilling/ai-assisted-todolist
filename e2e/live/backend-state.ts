/**
 * Finds out once, before any check runs, whether the environment's backend is up.
 *
 * While an environment is down, CloudFront answers every /api request itself with a 503 and
 * this exact text (spa-routing.js in the AWS module). That is an expected state, not a failure:
 * the API checks then skip with the message, and the frontend checks still run, because the site
 * outlives `down`. Anything else that is not a 200 is a real failure and is left to the checks
 * to report.
 *
 * The answer reaches the test workers through process.env, which Playwright hands on from the
 * global setup; the job summary gets one line saying which case this was.
 */
import { appendFileSync } from 'node:fs'
import { request, type FullConfig } from '@playwright/test'

export const DOWN_MESSAGE = 'The backend is not running in this environment.'

export default async function backendState(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL
  const context = await request.newContext({ baseURL })
  const response = await context.get('/api/auth/providers')
  const down = response.status() === 503 && (await response.text()).trim() === DOWN_MESSAGE
  await context.dispose()

  process.env.LIVE_BACKEND_DOWN = down ? '1' : ''
  summary(down
    ? `**${baseURL} is down** -- the API checks are skipped, the frontend checks ran.`
    : `**${baseURL} is up** -- all checks ran.`)
}

function summary(line: string) {
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
  }
}
