/**
 * What can be checked in a deployed environment without signing in (#142).
 *
 * Everything #119 and #110 checked by hand after each change, plus what each deployment itself
 * sets up (deploy-frontend.yml's cache headers). Two groups: the frontend, served from the site
 * bucket and checked even while the environment is down, and the API through CloudFront, skipped
 * with the reason when it is (backend-state.ts).
 *
 * Mostly plain HTTP through Playwright's request fixture rather than a page: what is being
 * checked is status codes and headers, and a browser would follow, cache or hide them.
 */
import { expect, test } from '@playwright/test'
import { DOWN_MESSAGE } from './backend-state'

test.describe('the frontend', () => {
  test('loads the app', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('TaskFest')
  })

  test('answers a deep link with the app, not a 403', async ({ request }) => {
    const response = await request.get('/some/client/route')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/html')
    expect(await response.text()).toContain('<div id="root">')
  })

  test('answers a missing asset with a 403, not the app', async ({ request }) => {
    const response = await request.get('/assets/does-not-exist.js')
    expect(response.status()).toBe(403)
    expect(response.headers()['content-type']).not.toContain('text/html')
  })

  test('serves index.html uncached and the hashed assets as immutable', async ({ request }) => {
    const index = await request.get('/')
    // no-cache is what makes a new release visible at once without an invalidation.
    expect(index.headers()['cache-control']).toBe('no-cache')

    const asset = (await index.text()).match(/\/assets\/[^"]+\.js/)?.[0]
    expect(asset, 'index.html names no hashed script').toBeTruthy()
    const script = await request.get(asset!)
    expect(script.status()).toBe(200)
    expect(script.headers()['cache-control']).toContain('immutable')
  })
})

test.describe('the API through CloudFront', () => {
  test.skip(() => process.env.LIVE_BACKEND_DOWN === '1', DOWN_MESSAGE)

  test('offers Google as an available sign-in provider', async ({ request }) => {
    const response = await request.get('/api/auth/providers')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.enabled).toBe(true)
    expect(body.providers).toContainEqual(expect.objectContaining({ id: 'google', available: true }))
  })

  test('refuses a protected path without a session', async ({ request }) => {
    // The frontend's fetches send this header, and Quarkus answers them with a 499 instead of a
    // redirect into a login page a script could not follow.
    const script = await request.get('/api/tasks', { headers: { 'X-Requested-With': 'JavaScript' }, maxRedirects: 0 })
    expect(script.status()).toBe(499)

    // A browser navigation is sent to sign in instead -- never the data, and never the app.
    const navigation = await request.get('/api/tasks', { maxRedirects: 0 })
    expect(navigation.status()).toBe(302)
    expect(navigation.headers()['location']).toMatch(/^https:\/\/accounts\.google\.com\//)
  })

  test('does not cache /api/*', async ({ request }) => {
    // Twice, so a cache that stored the first answer would have to say Hit on the second.
    await request.get('/api/auth/providers')
    const second = await request.get('/api/auth/providers')
    expect(second.headers()['x-cache']).toBe('Miss from cloudfront')
  })

  test('sends sign-in to Google with this environment as the https return address', async ({ page, request, baseURL }) => {
    // Up to Google's door and no further: following the button is checked, signing in at Google
    // is not -- Google forbids automating it (#141).
    await page.goto('/')
    const signIn = page.getByRole('link', { name: /continue with google/i })
    await expect(signIn).toBeVisible()

    const response = await request.get((await signIn.getAttribute('href'))!, { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    const location = new URL(response.headers()['location'])
    expect(location.origin).toBe('https://accounts.google.com')
    // The regression from #119: behind the load balancer the backend once asked Google to come
    // back to http://, which Google refuses.
    expect(location.searchParams.get('redirect_uri')).toBe(`${baseURL}/api/auth/callback`)
  })
})
