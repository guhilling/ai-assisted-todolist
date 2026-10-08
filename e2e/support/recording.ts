/**
 * A browser context for one account, recorded when the run records video (#240).
 *
 * The scenarios that need two accounts open a context per account -- a sign-out does not end the
 * provider's own session -- and a context a test opens itself records nothing unless it is asked
 * to, whatever the configuration says. These ask exactly when the configuration records the
 * runner's own contexts (the live signed-in run), and attach each video to the test under the name
 * the runner uses, `video`, so collect-live-videos.py publishes it like any other.
 */
import { test, type Browser, type BrowserContext } from '@playwright/test'

/** Whether this run records video: the configuration's `use.video`, as a mode or an object with one. */
function recording() {
  const video = test.info().project.use.video
  const mode = typeof video === 'object' ? video.mode : video
  return mode !== undefined && mode !== 'off'
}

/** A new context for one account, recording its pages when the run records video. */
export async function accountContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext(recording() ? { recordVideo: { dir: test.info().outputPath('accounts') } } : {})
}

/** Closes the context -- which is when its videos are written -- and attaches them to the test. */
export async function closeAccountContext(context: BrowserContext) {
  const videos = context.pages().flatMap((page) => (page.video() ? [page.video()!] : []))
  await context.close()
  for (const video of videos) {
    await test.info().attach('video', { path: await video.path(), contentType: 'video/webm' })
  }
}
