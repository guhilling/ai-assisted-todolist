/**
 * Behaviour tests for the board, run against a stubbed `fetch`.
 *
 * They cover what the user sees and does in each state -- signed out, signed in, completing,
 * adding, deleting -- without a backend, one `App.<feature>.test.tsx` file per feature; the
 * stub and the fixtures they share are under `testing/`. Anything needing a real session or
 * real persistence is left to the Playwright suite under /e2e.
 *
 * Dates are computed from the real today rather than hardcoded, because the board reads the
 * clock once on mount and groups rows by how far away they are. The arithmetic comes from
 * `dates.ts`, whose own tests pin it down directly.
 *
 * This file: the page before anyone has signed in, the paused page an environment shows
 * while its backend is off, and the footer every page carries.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { pausedEnvironment, respond, stubApi } from './testing/api'
import { ALICE, COGNITO, GOOGLE, renderSignedIn } from './testing/board'

const UNCONFIGURED_KEYCLOAK = {
  id: 'keycloak',
  label: 'Keycloak',
  available: false,
  loginUrl: null,
  issuer: '',
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('signed out', () => {
  it('carries the product name', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'TaskFest' })).toBeInTheDocument()
  })

  it('offers the configured provider and a link to the project, and no board', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /sign in with google/i })).toHaveAttribute('href', '/api/auth/login'),
    )
    expect(screen.getByRole('link', { name: /^about/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument()
  })

  it('does not offer a provider that has no credentials', async () => {
    globalThis.fetch = stubApi({
      providers: { enabled: true, providers: [GOOGLE, UNCONFIGURED_KEYCLOAK] },
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument())
    expect(screen.queryByText(/keycloak/i)).not.toBeInTheDocument()
  })

  it('says so when nothing is configured', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: false, providers: [] } }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Sign-in is not configured for this deployment.')).toBeInTheDocument(),
    )
  })

  it('still renders when the provider list is refused', async () => {
    globalThis.fetch = stubApi({ providers: 'error' }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Sign-in is not configured for this deployment.')).toBeInTheDocument(),
    )
  })

  it('still renders when the provider request fails outright', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/providers')) {
        return Promise.reject(new Error('Network is down.'))
      }
      return respond('error')
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Sign-in is not configured for this deployment.')).toBeInTheDocument(),
    )
  })

  it('offers sign-in even while the session probe is still outstanding', async () => {
    // A cold backend is slow on its first authenticated request, and the signed-out page is
    // nothing but the provider list -- so the button must not wait on the session probe.
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [GOOGLE] })
      }
      return new Promise<Response>(() => {})
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument())
  })
})

describe('sign-in buttons', () => {
  it("offers Google through Google's own button, light and dark", async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    const google = await screen.findByRole('link', { name: 'Sign in with Google' })
    expect(google).toHaveAttribute('href', '/api/auth/login')
    // The official asset as it comes: the image is the whole button, and its alt text is its name.
    expect(within(google).getByRole('img', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(google.querySelector('source[media="(prefers-color-scheme: dark)"]')).not.toBeNull()
  })

  it('offers every other provider with its label and an icon that says nothing twice', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [COGNITO, GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    const testAccount = await screen.findByRole('link', { name: 'Sign in with TaskFest test account' })
    expect(testAccount).toHaveAttribute('href', '/api/auth/login/cognito')
    // Decorative: the label already says which provider it is.
    expect(testAccount.querySelector('img')).toHaveAttribute('alt', '')
  })
})

describe('paused', () => {
  it('says which environment is paused while its backend is not running', async () => {
    globalThis.fetch = pausedEnvironment('QA')
    render(<App />)

    await waitFor(() => expect(screen.getByText('Environment QA is paused at the moment.')).toBeInTheDocument())
    expect(screen.getByRole('img', { name: /panda/i })).toBeInTheDocument()
    expect(screen.queryByText('Sign-in is not configured for this deployment.')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /sign in with/i })).not.toBeInTheDocument()
  })

  it('still says it is paused when the deployment does not name itself', async () => {
    globalThis.fetch = pausedEnvironment()
    render(<App />)

    await waitFor(() => expect(screen.getByText('This environment is paused at the moment.')).toBeInTheDocument())
  })

  it('ignores an environment name that is not a short string', async () => {
    globalThis.fetch = pausedEnvironment('x'.repeat(200))
    render(<App />)

    await waitFor(() => expect(screen.getByText('This environment is paused at the moment.')).toBeInTheDocument())
  })

  it('keeps a link to the project', async () => {
    globalThis.fetch = pausedEnvironment('QA')
    render(<App />)

    await waitFor(() => expect(screen.getByRole('link', { name: /^about/i })).toBeInTheDocument())
  })

  it('does not mistake any other 503 for a pause', async () => {
    // A load balancer with no healthy task answers 503 too, but that is an outage, not a pause.
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/')) {
        return Promise.resolve(new Response('<html>503 Service Temporarily Unavailable</html>', { status: 503 }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Sign-in is not configured for this deployment.')).toBeInTheDocument(),
    )
    expect(screen.queryByText(/is paused at the moment/)).not.toBeInTheDocument()
  })
})

/** The legal links every view carries (#193): the operator's imprint, the privacy policy, a contact. */
async function expectTheLegalFooter() {
  const imprint = await screen.findByRole('link', { name: 'Imprint' })
  expect(imprint).toHaveAttribute('href', 'https://www.hilling.it/impressum/')
  expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
    'href',
    'https://taskfest-docs.cloud.hilling.de/doc/privacy.html',
  )
  expect(screen.getByText('demo-apps[at]hilling.de')).toBeInTheDocument()
  // Written out against address harvesters: never as a plain address, and never as a mailto link.
  expect(document.body.innerHTML).not.toContain('demo-apps@hilling.de')
  expect(document.querySelector('a[href^="mailto:"]')).toBeNull()
}

describe('legal footer', () => {
  it('is on the signed-out page', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    await expectTheLegalFooter()
  })

  it('is on the paused page', async () => {
    globalThis.fetch = pausedEnvironment('QA')
    render(<App />)

    await screen.findByText('Environment QA is paused at the moment.')
    await expectTheLegalFooter()
  })

  it('is on the board', async () => {
    await renderSignedIn(stubApi({ me: ALICE, tasks: [] }))

    await expectTheLegalFooter()
  })
})

describe('version in the footer', () => {
  it('names the release the page was built from', async () => {
    vi.stubEnv('VITE_TASKFEST_VERSION', '0.7.2')
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByText('Version 0.7.2')).toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('says so when it is no release at all', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByText('Development build')).toBeInTheDocument()
  })

  it('links the project as just "About"', async () => {
    globalThis.fetch = stubApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('link', { name: 'About ↗' })).toBeInTheDocument()
  })
})
