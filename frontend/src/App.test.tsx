/**
 * Behaviour tests for the board, run against a stubbed `fetch`.
 *
 * They cover what the user sees and does in each state -- signed out, signed in, completing,
 * adding, deleting -- without a backend. Anything needing a real session or real persistence
 * is left to the Playwright suite under /e2e.
 *
 * Dates are computed from the real today rather than hardcoded, because the board reads the
 * clock once on mount and groups rows by how far away they are. The arithmetic comes from
 * `dates.ts`, whose own tests pin it down directly.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { addDays, todayIso } from './dates'

const TODAY = todayIso()

/** An ISO date `offset` days from today, for readable fixtures. */
function isoIn(offset: number) {
  return addDays(TODAY, offset)
}

/**
 * A 200 carrying `value`; a 401 for the sentinel `'error'`, which on a signed-in request now
 * means the session has gone; a 500 for `'server-error'`, a failure on the server's side.
 */
function respond(value: unknown, status = 200) {
  if (value === 'error') {
    return Promise.resolve(new Response(null, { status: 401 }))
  }
  if (value === 'server-error') {
    return Promise.resolve(new Response(null, { status: 500 }))
  }
  if (value === null) {
    return Promise.resolve(new Response(null, { status }))
  }
  return Promise.resolve(new Response(JSON.stringify(value), { status }))
}

/**
 * A stub that answers by method as well as by path.
 *
 * The mutating paths all live behind POST, PUT and DELETE on the same `/api/tasks` URL, so
 * telling a create from a list needs the method rather than just the path.
 */
function mockApi(options: {
  me?: unknown
  providers?: unknown
  tasks?: unknown
  post?: { status: number; body?: unknown }
  /**
   * Answers every POST by echoing what was sent back with a fresh id, the way the server
   * does. Restoring several tasks at once needs this rather than a fixed list of replies,
   * because the order they are deleted in is the board's, not the test's.
   */
  echoPost?: boolean
  put?: { status: number; body?: unknown }
  del?: { status: number }
}) {
  let nextId = 90
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'

    if (url.includes('/api/auth/me')) {
      return respond(options.me ?? 'error')
    }
    if (url.includes('/api/auth/providers')) {
      return respond(options.providers ?? { enabled: true, providers: [] })
    }
    if (url.includes('/api/tasks')) {
      if (method === 'POST') {
        if (options.echoPost) {
          nextId += 1
          return respond({ ...JSON.parse(String(init?.body)), id: nextId }, 201)
        }
        return respond(options.post?.body ?? null, options.post?.status ?? 201)
      }
      if (method === 'PUT') {
        return respond(options.put?.body ?? null, options.put?.status ?? 200)
      }
      if (method === 'DELETE') {
        return respond(null, options.del?.status ?? 204)
      }
      return respond(options.tasks ?? [])
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

const ALICE = { email: 'alice@example.com' }

const GOOGLE = {
  id: 'google',
  label: 'Google',
  available: true,
  loginUrl: '/api/auth/login',
  issuer: 'https://accounts.google.com',
}

const UNCONFIGURED_KEYCLOAK = {
  id: 'keycloak',
  label: 'Keycloak',
  available: false,
  loginUrl: null,
  issuer: '',
}

function task(overrides: Partial<{ id: number; description: string; dueDate: string; importance: string; state: string }>) {
  return {
    id: 1,
    description: 'A task',
    dueDate: isoIn(1),
    importance: 'MEDIUM',
    state: 'TODO',
    ...overrides,
  }
}

/** Waits for the signed-in board. The add row exists only once there is a session. */
async function renderSignedIn(fetchMock: ReturnType<typeof mockApi>) {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  render(<App />)
  await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())
}

/** The `<li>` for one task, so per-row controls can be addressed unambiguously. */
function rowFor(description: string) {
  const checkbox = screen.getByLabelText(`Mark "${description}" as done`)
  const row = checkbox.closest('li')
  if (!row) {
    throw new Error(`No row found for "${description}"`)
  }
  return row
}

/** Opens a row's overflow menu, as a user must before its actions are reachable. */
function openMenu(description: string) {
  // jsdom implements summary-toggles-details, so the click alone opens it.
  fireEvent.click(within(rowFor(description)).getByLabelText(`Actions for "${description}"`))
  return within(rowFor(description))
}

/** The `<details>` element backing a row's menu, for asserting whether it is open. */
function menuOf(description: string) {
  return rowFor(description).querySelector('details') as HTMLDetailsElement
}

function bodyOf(fetchMock: ReturnType<typeof mockApi>, method: string) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === method)
  return JSON.parse(String(call?.[1]?.body))
}

/** Expands the add row and fills in a description. */
function startAdding(description: string) {
  fireEvent.click(screen.getByRole('button', { name: /add a task/i }))
  fireEvent.change(screen.getByLabelText('What needs doing'), { target: { value: description } })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('signed out', () => {
  it('carries the product name', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'TaskFest' })).toBeInTheDocument()
  })

  it('offers the configured provider and a link to the project, and no board', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /sign in with google/i })).toHaveAttribute('href', '/api/auth/login'),
    )
    expect(screen.getByRole('link', { name: /^about/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument()
  })

  it('does not offer a provider that has no credentials', async () => {
    globalThis.fetch = mockApi({
      providers: { enabled: true, providers: [GOOGLE, UNCONFIGURED_KEYCLOAK] },
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument())
    expect(screen.queryByText(/keycloak/i)).not.toBeInTheDocument()
  })

  it('says so when nothing is configured', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: false, providers: [] } }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() =>
      expect(screen.getByText('Sign-in is not configured for this deployment.')).toBeInTheDocument(),
    )
  })

  it('still renders when the provider list is refused', async () => {
    globalThis.fetch = mockApi({ providers: 'error' }) as unknown as typeof fetch
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

/**
 * What CloudFront answers every /api request with while an environment is down: its own 503,
 * with this text (spa-routing.js in the AWS module). The site itself is still served.
 */
const PAUSED = () => Promise.resolve(new Response('The backend is not running in this environment.\n', { status: 503 }))

/** A stub for a paused environment, naming itself through `/environment.json` when `name` is given. */
function pausedEnvironment(name?: string) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/')) {
      return PAUSED()
    }
    if (url.endsWith('/environment.json') && name !== undefined) {
      return respond({ name })
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  }) as unknown as typeof fetch
}

const COGNITO = {
  id: 'cognito',
  label: 'TaskFest test account',
  available: true,
  loginUrl: '/api/auth/login/cognito',
  issuer: 'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_pool',
}

describe('sign-in buttons', () => {
  it("offers Google through Google's own button, light and dark", async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    const google = await screen.findByRole('link', { name: 'Sign in with Google' })
    expect(google).toHaveAttribute('href', '/api/auth/login')
    // The official asset as it comes: the image is the whole button, and its alt text is its name.
    expect(within(google).getByRole('img', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(google.querySelector('source[media="(prefers-color-scheme: dark)"]')).not.toBeNull()
  })

  it('offers every other provider with its label and an icon that says nothing twice', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [COGNITO, GOOGLE] } }) as unknown as typeof fetch
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
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
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
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    await expectTheLegalFooter()
  })
})

describe('version in the footer', () => {
  it('names the release the page was built from', async () => {
    vi.stubEnv('VITE_TASKFEST_VERSION', '0.7.2')
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByText('Version 0.7.2')).toBeInTheDocument()
    vi.unstubAllEnvs()
  })

  it('says so when it is no release at all', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByText('Development build')).toBeInTheDocument()
  })

  it('links the project as just "About"', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('link', { name: 'About ↗' })).toBeInTheDocument()
  })
})

describe('in German', () => {
  // The visitor's remembered choice, which wins over the browser's preference (i18n/language.ts).
  beforeEach(() => localStorage.setItem('taskfest.language', 'de'))
  afterEach(() => {
    localStorage.removeItem('taskfest.language')
    document.documentElement.lang = 'en'
  })

  it('speaks German on the signed-out page, and says so to screen readers', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [COGNITO, GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('link', { name: 'Mit TaskFest test account anmelden' })).toBeInTheDocument()
    expect(screen.getByText('Deine eigene Liste – privat für alle, die sich anmelden.')).toBeInTheDocument()
    // Google's official button exists in English only (D3 on #203).
    expect(screen.getByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Impressum' })).toBeInTheDocument()
    // The German privacy policy, not the English one (D4 on #203).
    expect(screen.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute(
      'href',
      'https://taskfest-docs.cloud.hilling.de/doc/datenschutz.html',
    )
    expect(document.documentElement.lang).toBe('de')
  })

  it('speaks German on the paused page', async () => {
    globalThis.fetch = pausedEnvironment('QA')
    render(<App />)

    expect(await screen.findByText('Die Umgebung QA ist gerade pausiert.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Ein Comic-Panda, der an Bambus kaut' })).toBeInTheDocument()
  })

  it('speaks German on the board, due dates and importance included', async () => {
    globalThis.fetch = mockApi({
      me: ALICE,
      tasks: [task({ id: 7, description: 'Pass erneuern', dueDate: isoIn(1), importance: 'HIGH' })],
    }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Aufgabe hinzufügen' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Morgen' })).toBeInTheDocument()
    expect(screen.getByLabelText('„Pass erneuern“ als erledigt markieren')).toBeInTheDocument()
    expect(screen.getByText('Hoch')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abmelden' })).toBeInTheDocument()
  })

  it('reports a failure in German', async () => {
    globalThis.fetch = mockApi({ me: ALICE, tasks: 'server-error' }) as unknown as typeof fetch
    render(<App />)

    expect(await screen.findByText('Die Aufgaben konnten nicht vom Backend geladen werden.')).toBeInTheDocument()
  })
})

describe('the language switch', () => {
  afterEach(() => {
    localStorage.removeItem('taskfest.language')
    document.documentElement.lang = 'en'
  })

  it('translates a failure already on screen', async () => {
    globalThis.fetch = mockApi({ me: ALICE, tasks: 'server-error' }) as unknown as typeof fetch
    render(<App />)
    await screen.findByText('Unable to load tasks from the backend.')

    fireEvent.click(screen.getByRole('button', { name: 'Deutsch' }))

    expect(await screen.findByText('Die Aufgaben konnten nicht vom Backend geladen werden.')).toBeInTheDocument()
  })

  it('switches to German and back, and remembers the choice', async () => {
    globalThis.fetch = mockApi({ providers: { enabled: true, providers: [GOOGLE] } }) as unknown as typeof fetch
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Deutsch' }))

    expect(await screen.findByText('Deine eigene Liste – privat für alle, die sich anmelden.')).toBeInTheDocument()
    expect(localStorage.getItem('taskfest.language')).toBe('de')
    expect(document.documentElement.lang).toBe('de')

    fireEvent.click(screen.getByRole('button', { name: 'English' }))

    expect(await screen.findByText('Your own list, private to whoever signs in.')).toBeInTheDocument()
    expect(localStorage.getItem('taskfest.language')).toBe('en')
  })
})

describe('signed in', () => {
  it('carries the product name', async () => {
    await renderSignedIn(mockApi({ me: ALICE }))

    expect(screen.getByRole('heading', { level: 1, name: 'TaskFest' })).toBeInTheDocument()
  })

  it('shows who is signed in and a way out', async () => {
    await renderSignedIn(mockApi({ me: ALICE }))

    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign out/i })).toHaveAttribute('href', '/api/auth/logout')
  })

  it('sends credentials on task requests', async () => {
    const fetchMock = mockApi({ me: ALICE })
    await renderSignedIn(fetchMock)

    const tasksCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/tasks'))
    expect(tasksCall?.[1]).toMatchObject({ credentials: 'include' })
  })

  it('says when there is nothing on the board', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    expect(screen.getByText('Nothing here yet. Add your first task.')).toBeInTheDocument()
  })

  it('offers nothing to interact with until the board has arrived', async () => {
    // The list response replaces the whole array, so anything added or ticked before it
    // lands is discarded. The board therefore stays out of reach until it is real.
    let releaseTasks: (value: Response) => void = () => {}
    const tasksArrived = new Promise<Response>((resolve) => {
      releaseTasks = resolve
    })
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return respond(ALICE)
      }
      if (url.includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [] })
      }
      return tasksArrived
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Loading tasks…')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument()

    releaseTasks(new Response(JSON.stringify([]), { status: 200 }))

    await waitFor(() => expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument())
  })

  it('shows a loading note until the board arrives', async () => {
    // The board's own fetch is held open, because the loading state is by nature transient:
    // letting the stub resolve immediately makes this a race that passes on timing rather
    // than on behaviour.
    let releaseTasks: (value: Response) => void = () => {}
    const tasksArrived = new Promise<Response>((resolve) => {
      releaseTasks = resolve
    })
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return respond(ALICE)
      }
      if (url.includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [] })
      }
      return tasksArrived
    }) as unknown as typeof fetch

    render(<App />)

    await waitFor(() => expect(screen.getByText('Loading tasks…')).toBeInTheDocument())

    releaseTasks(new Response(JSON.stringify([]), { status: 200 }))

    await waitFor(() => expect(screen.queryByText('Loading tasks…')).not.toBeInTheDocument())
    expect(screen.getByText('Nothing here yet. Add your first task.')).toBeInTheDocument()
  })

  it('reports a failure to load the board', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: 'server-error' }))

    await waitFor(() =>
      expect(screen.getByText('Unable to load tasks from the backend.')).toBeInTheDocument(),
    )
  })

  it('falls back to a generic message when the failure is not an Error', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify(ALICE), { status: 200 }))
      }
      if (url.includes('/api/auth/providers')) {
        return Promise.resolve(new Response(JSON.stringify({ enabled: true, providers: [] }), { status: 200 }))
      }
      return Promise.reject('not an Error at all')
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText('Unexpected error while loading data.')).toBeInTheDocument())
  })

  it('shows a failure on the signed-out page when the session probe itself breaks', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/auth/providers')) {
        return respond({ enabled: true, providers: [GOOGLE] })
      }
      return Promise.reject(new Error('Network is down.'))
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText('Network is down.')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument()
  })
})

describe('who is signed in', () => {
  it('shows the display name in place of the email when the provider gave one', async () => {
    await renderSignedIn(mockApi({ me: { ...ALICE, name: 'Alice Example' }, tasks: [] }))

    expect(screen.getByText('Alice Example')).toBeInTheDocument()
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument()
  })

  it('falls back to the email when there is no name', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
  })

  it('shows the picture the backend resolved', async () => {
    await renderSignedIn(
      mockApi({ me: { ...ALICE, pictureUrl: 'https://example.com/alice.png' }, tasks: [] }),
    )

    const avatar = document.querySelector('.user-avatar') as HTMLImageElement
    expect(avatar.tagName).toBe('IMG')
    expect(avatar).toHaveAttribute('src', 'https://example.com/alice.png')
  })

  it('falls back to initials when the picture will not load', async () => {
    // A URL the backend confirmed can still rot; a broken image icon is worse than initials.
    await renderSignedIn(
      mockApi({
        me: { ...ALICE, name: 'Alice Example', pictureUrl: 'https://example.com/gone.png' },
        tasks: [],
      }),
    )

    fireEvent.error(document.querySelector('.user-avatar') as HTMLImageElement)

    expect(screen.getByText('AE')).toBeInTheDocument()
  })

  it.each([
    ['a two-word name', { name: 'Gunnar Hilling' }, 'GH'],
    ['a one-word name', { name: 'Gunnar' }, 'G'],
    ['a dotted email local part', { name: null }, 'AE'],
  ])('builds initials from %s', async (_case, extra, expected) => {
    const me = { email: 'alice.example@example.com', ...extra }
    await renderSignedIn(mockApi({ me, tasks: [] }))

    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

describe('the board', () => {
  it('shows each task with when it is due and how much it matters', async () => {
    await renderSignedIn(
      mockApi({
        me: ALICE,
        tasks: [task({ id: 7, description: 'Write the report', dueDate: isoIn(1), importance: 'HIGH' })],
      }),
    )

    const row = rowFor('Write the report')
    // The section heading already says when; the row does not say it a second time.
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(within(row).queryByText('Tomorrow')).not.toBeInTheDocument()
    expect(within(row).getByText('High')).toBeInTheDocument()
  })

  it('words a due date the section heading does not already say', async () => {
    await renderSignedIn(
      mockApi({
        me: ALICE,
        tasks: [
          task({ id: 8, description: 'Overdue one', dueDate: isoIn(-1) }),
          task({ id: 9, description: 'Done today', dueDate: isoIn(0), state: 'DONE' }),
        ],
      }),
    )

    // "Overdue" covers many days, so the row says which; "Completed" says nothing about dates.
    expect(within(rowFor('Overdue one')).getByText('Yesterday')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/^Completed/))
    expect(within(rowFor('Done today')).getByText('Today')).toBeInTheDocument()
  })

  it('groups tasks by when they are due', async () => {
    await renderSignedIn(
      mockApi({
        me: ALICE,
        tasks: [
          task({ id: 1, description: 'Late thing', dueDate: isoIn(-2) }),
          task({ id: 2, description: 'Today thing', dueDate: TODAY }),
          task({ id: 3, description: 'Tomorrow thing', dueDate: isoIn(1) }),
          task({ id: 4, description: 'Week thing', dueDate: isoIn(3) }),
          task({ id: 5, description: 'Far thing', dueDate: isoIn(30) }),
        ],
      }),
    )

    expect(screen.getByRole('heading', { name: 'Overdue' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This week' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Later' })).toBeInTheDocument()
    expect(within(rowFor('Late thing')).getByText('2 days ago')).toBeInTheDocument()
  })

  it('renders tasks in due date order whatever order they arrive in', async () => {
    await renderSignedIn(
      mockApi({
        me: ALICE,
        tasks: [
          task({ id: 1, description: 'Second', dueDate: isoIn(20) }),
          task({ id: 2, description: 'First', dueDate: isoIn(10) }),
        ],
      }),
    )

    const descriptions = screen.getAllByText(/^(First|Second)$/).map((node) => node.textContent)
    expect(descriptions).toEqual(['First', 'Second'])
  })

  it('orders two tasks on the same day by id, so the board never reshuffles', async () => {
    await renderSignedIn(
      mockApi({
        me: ALICE,
        tasks: [
          task({ id: 9, description: 'Added later', dueDate: isoIn(2) }),
          task({ id: 2, description: 'Added first', dueDate: isoIn(2) }),
        ],
      }),
    )

    const descriptions = screen.getAllByText(/^Added (first|later)$/).map((node) => node.textContent)
    expect(descriptions).toEqual(['Added first', 'Added later'])
  })

  it('leaves a section out when it has no tasks', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ description: 'Only tomorrow', dueDate: isoIn(1) })] }))

    expect(screen.getByRole('heading', { name: 'Tomorrow' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Overdue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Later' })).not.toBeInTheDocument()
  })

  it('marks a task in progress from its menu', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 3, description: 'Ongoing' })],
      put: { status: 200, body: task({ id: 3, description: 'Ongoing', state: 'WORKING' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Ongoing').getByRole('button', { name: /mark as in progress/i }))

    await waitFor(() => expect(within(rowFor('Ongoing')).getByText('doing')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ state: 'WORKING' })
    expect(openMenu('Ongoing').getByRole('button', { name: /mark as not started/i })).toBeInTheDocument()
  })

  it('marks an in-progress task back to not started', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 31, description: 'Paused', state: 'WORKING' })],
      put: { status: 200, body: task({ id: 31, description: 'Paused', state: 'TODO' }) },
    })
    await renderSignedIn(fetchMock)

    expect(within(rowFor('Paused')).getByText('doing')).toBeInTheDocument()
    fireEvent.click(openMenu('Paused').getByRole('button', { name: /mark as not started/i }))

    await waitFor(() => expect(within(rowFor('Paused')).queryByText('doing')).not.toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ state: 'TODO' })
  })
})

describe('completing a task', () => {
  it('finishes a task in one click and sends the whole task back', async () => {
    const done = task({ id: 4, description: 'Pay the invoice', dueDate: isoIn(1), state: 'DONE' })
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 4, description: 'Pay the invoice', dueDate: isoIn(1) })],
      put: { status: 200, body: done },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Pay the invoice" as done'))

    await waitFor(() => expect(screen.getByText('Completed (1)')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toEqual({
      description: 'Pay the invoice',
      dueDate: isoIn(1),
      importance: 'MEDIUM',
      state: 'DONE',
    })
    expect(screen.getByLabelText('Mark "Pay the invoice" as done')).toBeChecked()
  })

  it('completes a task whose due date has already passed', async () => {
    const overdue = isoIn(-3)
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 5, description: 'Late thing', dueDate: overdue })],
      put: { status: 200, body: task({ id: 5, description: 'Late thing', dueDate: overdue, state: 'DONE' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Late thing" as done'))

    await waitFor(() => expect(screen.getByText('Completed (1)')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueDate: overdue, state: 'DONE' })
  })

  it('puts a completed task back when it is unticked', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 6, description: 'Done thing', state: 'DONE' })],
      put: { status: 200, body: task({ id: 6, description: 'Done thing', state: 'TODO' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Done thing" as done'))

    await waitFor(() => expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ state: 'TODO' }))
    await waitFor(() => expect(screen.queryByText(/^Completed/)).not.toBeInTheDocument())
  })

  it('rolls the tick back and explains itself when the save fails', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 7, description: 'Stubborn thing' })],
      put: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Stubborn thing" as done'))

    await waitFor(() => expect(screen.getByText('Unable to update task.')).toBeInTheDocument())
    expect(screen.getByLabelText('Mark "Stubborn thing" as done')).not.toBeChecked()
  })

  it('leaves the other tasks alone when one changes state', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [
        task({ id: 1, description: 'First', dueDate: isoIn(2) }),
        task({ id: 2, description: 'Second', dueDate: isoIn(3) }),
      ],
      put: { status: 200, body: task({ id: 1, description: 'First', dueDate: isoIn(2), state: 'DONE' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "First" as done'))

    await waitFor(() => expect(screen.getByLabelText('Mark "First" as done')).toBeChecked())
    expect(screen.getByLabelText('Mark "Second" as done')).not.toBeChecked()
  })
})

describe('adding a task', () => {
  it('adds a task, shows it, and clears the form', async () => {
    const created = task({ id: 9, description: 'Buy milk', dueDate: isoIn(1) })
    const fetchMock = mockApi({ me: ALICE, tasks: [], post: { status: 201, body: created } })
    await renderSignedIn(fetchMock)

    startAdding('Buy milk')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Buy milk" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toEqual({
      description: 'Buy milk',
      dueDate: isoIn(1),
      importance: 'MEDIUM',
      state: 'TODO',
    })
    expect(screen.getByLabelText('What needs doing')).toHaveValue('')
  })

  it('defaults to tomorrow, so adding a task needs no date interaction', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    fireEvent.click(screen.getByRole('button', { name: /add a task/i }))

    expect(screen.getByLabelText('Due date')).toHaveValue(isoIn(1))
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
  })

  it.each([
    ['Today', 0],
    ['Tomorrow', 1],
    ['In 1 week', 7],
    ['In 2 weeks', 14],
  ])('sets the due date from the %s shortcut', async (label, offset) => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [],
      post: { status: 201, body: task({ id: 1, description: 'Chip task', dueDate: isoIn(offset) }) },
    })
    await renderSignedIn(fetchMock)

    startAdding('Chip task')
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(screen.getByLabelText('Due date')).toHaveValue(isoIn(offset))

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: isoIn(offset) }))
  })

  it('carries the chosen importance and a typed date', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [],
      post: { status: 201, body: task({ id: 1, description: 'Urgent thing', dueDate: isoIn(5), importance: 'HIGH' }) },
    })
    await renderSignedIn(fetchMock)

    startAdding('Urgent thing')
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: isoIn(5) } })
    fireEvent.change(screen.getByLabelText('Importance'), { target: { value: 'HIGH' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: isoIn(5), importance: 'HIGH' }),
    )
  })

  it('reports a failed add without losing what was typed', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [], post: { status: 500 } }))

    startAdding('Doomed task')
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.getByText('Unable to create task.')).toBeInTheDocument())
    expect(screen.getByLabelText('What needs doing')).toHaveValue('Doomed task')
  })

  it('will not add a task with no description', async () => {
    const fetchMock = mockApi({ me: ALICE, tasks: [] })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /add a task/i }))
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    fireEvent.submit(screen.getByLabelText('What needs doing').closest('form') as HTMLFormElement)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('keeps the add row open for any other key', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    startAdding('Still typing')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'a' })

    expect(screen.getByLabelText('What needs doing')).toHaveValue('Still typing')
  })

  it('collapses on Escape and on Cancel, forgetting what was typed', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    startAdding('Abandoned')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument()

    startAdding('Abandoned again')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /add a task/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /add a task/i }))
    expect(screen.getByLabelText('What needs doing')).toHaveValue('')
  })
})

describe('the row menu', () => {
  it('closes once an action has been chosen', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 41, description: 'Menu task' })],
      put: { status: 200, body: task({ id: 41, description: 'Menu task', state: 'WORKING' }) },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Menu task').getByRole('button', { name: /mark as in progress/i }))

    expect(menuOf('Menu task').open).toBe(false)
  })

  it('survives the click that opened it', async () => {
    // React can flush the effect while the opening click is still propagating, which closed
    // the menu the instant it opened. Only the browser showed it; jsdom did not.
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 44, description: 'Menu task' })] }))

    const summary = within(rowFor('Menu task')).getByLabelText('Actions for "Menu task"')
    fireEvent.click(summary)
    fireEvent.click(summary.closest('details') as HTMLElement)

    expect(menuOf('Menu task').open).toBe(true)
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 45, description: 'Menu task' })] }))

    openMenu('Menu task')
    expect(menuOf('Menu task').open).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(menuOf('Menu task').open).toBe(false)
    expect(within(rowFor('Menu task')).getByLabelText('Actions for "Menu task"')).toHaveFocus()
  })

  it('ignores other keys while it is open', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 46, description: 'Menu task' })] }))

    openMenu('Menu task')
    fireEvent.keyDown(document, { key: 'a' })

    expect(menuOf('Menu task').open).toBe(true)
  })

  it('closes when the click lands somewhere else', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 42, description: 'Menu task' })] }))

    openMenu('Menu task')
    expect(menuOf('Menu task').open).toBe(true)

    fireEvent.click(document.body)

    expect(menuOf('Menu task').open).toBe(false)
  })

  it('stays open until something is clicked', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 43, description: 'Menu task' })] }))

    openMenu('Menu task')

    expect(menuOf('Menu task').open).toBe(true)
  })
})

describe('the keyboard shortcut', () => {
  it('opens the add row when n is pressed', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    fireEvent.keyDown(document.body, { key: 'n' })

    expect(screen.getByLabelText('What needs doing')).toBeInTheDocument()
  })

  it('leaves the letter alone when it lands in a field', async () => {
    // A row's checkbox is a real input, so it stands in for "the caret is somewhere that
    // takes typing" -- where the shortcut must not swallow the letter.
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 47, description: 'A task' })] }))

    fireEvent.keyDown(screen.getByLabelText('Mark "A task" as done'), { key: 'n' })

    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()
  })

  it('does not fire when a modifier is held', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    fireEvent.keyDown(document.body, { key: 'n', metaKey: true })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'n', altKey: true })
    expect(screen.queryByLabelText('What needs doing')).not.toBeInTheDocument()
  })

  it('is ignored once the add row is already open', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [] }))

    startAdding('Typing away')
    fireEvent.keyDown(screen.getByLabelText('What needs doing'), { key: 'n' })

    expect(screen.getByLabelText('What needs doing')).toHaveValue('Typing away')
  })
})

describe('importance', () => {
  it('shows a dot, and says the word to a screen reader', async () => {
    await renderSignedIn(
      mockApi({ me: ALICE, tasks: [task({ id: 51, description: 'Urgent', importance: 'HIGH' })] }),
    )

    const row = rowFor('Urgent')
    // The word is present for assistive technology but carries no visible text of its own.
    expect(within(row).getByText('High')).toHaveClass('visually-hidden')
    expect(row.querySelector('.task-importance--high')).not.toBeNull()
  })

  it.each([
    ['LOW', 'Low'],
    ['MEDIUM', 'Medium'],
    ['HIGH', 'High'],
  ])('distinguishes %s', async (importance, label) => {
    await renderSignedIn(
      mockApi({ me: ALICE, tasks: [task({ id: 52, description: 'Graded', importance })] }),
    )

    const row = rowFor('Graded')
    expect(within(row).getByText(label)).toBeInTheDocument()
    expect(row.querySelector(`.task-importance--${importance.toLowerCase()}`)).not.toBeNull()
  })
})

describe('removing tasks', () => {
  it('deletes a task from its menu', async () => {
    const fetchMock = mockApi({ me: ALICE, tasks: [task({ id: 11, description: 'Unwanted' })] })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Unwanted').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.queryByLabelText('Mark "Unwanted" as done')).not.toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).endsWith('/11'))).toBe(
      true,
    )
  })

  it('puts the task back when the delete fails', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 12, description: 'Sticky' })],
      del: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Sticky').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Unable to delete task.')).toBeInTheDocument())
    expect(screen.getByLabelText('Mark "Sticky" as done')).toBeInTheDocument()
  })

  it('offers to undo, and puts the task back', async () => {
    const gone = task({ id: 13, description: 'Deleted by mistake', dueDate: isoIn(4) })
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [gone],
      echoPost: true,
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Deleted by mistake').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Deleted by mistake" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toEqual({
      description: 'Deleted by mistake',
      dueDate: isoIn(4),
      importance: 'MEDIUM',
      state: 'TODO',
    })
    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument()
  })

  it('restores an overdue task by creating it today and correcting the date', async () => {
    // Creating refuses a date in the past, so a plain re-create would fail for exactly the
    // tasks people delete most. The date is repaired by an update, which does allow one.
    const overdue = isoIn(-5)
    const gone = task({ id: 14, description: 'Long overdue', dueDate: overdue })
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [gone],
      echoPost: true,
      put: { status: 200, body: { ...gone, id: 98 } },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Long overdue').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Long overdue" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'POST')).toMatchObject({ dueDate: TODAY })
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueDate: overdue })
  })

  it('reports a restore that fails', async () => {
    const gone = task({ id: 15, description: 'Unrestorable', dueDate: isoIn(4) })
    const fetchMock = mockApi({ me: ALICE, tasks: [gone], post: { status: 500 } })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Unrestorable').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByText('Unable to create task.')).toBeInTheDocument())
  })

  it('can be dismissed', async () => {
    // No fake clock: dismissing is a click, and the countdown is another test's business.
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 16, description: 'Gone for good' })] }))

    fireEvent.click(openMenu('Gone for good').getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument()
  })

  it('withdraws the offer after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 17, description: 'Times out' })] }))

      fireEvent.click(openMenu('Times out').getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(screen.getByText('Task deleted')).toBeInTheDocument())

      // advanceTimersByTimeAsync, not the synchronous form: it yields between timers so the
      // state update the callback schedules is actually flushed. And the disappearance is
      // waited for rather than asserted on the next line -- advancing the clock says the
      // callback ran, not that React has re-rendered, and asserting instantly made this test
      // fail on a loaded CI runner roughly one run in three.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(8000)
      })

      await waitFor(() => expect(screen.queryByText('Task deleted')).not.toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not offer an undo for a delete that failed', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 18, description: 'Sticky again' })],
      del: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(openMenu('Sticky again').getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(screen.getByText('Unable to delete task.')).toBeInTheDocument())
    expect(screen.queryByText('Task deleted')).not.toBeInTheDocument()
  })

  it('clears every completed task at once', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [
        task({ id: 21, description: 'Done one', state: 'DONE' }),
        task({ id: 22, description: 'Done two', state: 'DONE' }),
        task({ id: 23, description: 'Still open' }),
      ],
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))

    await waitFor(() => expect(screen.queryByText(/^Completed/)).not.toBeInTheDocument())
    const deleted = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => String(url))
    expect(deleted).toHaveLength(2)
    expect(screen.getByLabelText('Mark "Still open" as done')).toBeInTheDocument()
    // One offer covering the batch, not one per task.
    expect(screen.getByText('2 tasks deleted')).toBeInTheDocument()
  })

  it('offers no undo when clearing the completed section fails outright', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [
        task({ id: 26, description: 'Done one', dueDate: isoIn(2), state: 'DONE' }),
        task({ id: 27, description: 'Done two', dueDate: isoIn(3), state: 'DONE' }),
      ],
      del: { status: 500 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))

    await waitFor(() => expect(screen.getByText('Unable to delete task.')).toBeInTheDocument())
    // Nothing was removed, so there is nothing to offer back.
    expect(screen.queryByText(/deleted$/)).not.toBeInTheDocument()
    expect(screen.getByText('Completed (2)')).toBeInTheDocument()
  })

  it('puts a whole cleared batch back', async () => {
    const one = task({ id: 24, description: 'Done one', dueDate: isoIn(2), state: 'DONE' })
    const two = task({ id: 25, description: 'Done two', dueDate: isoIn(3), state: 'DONE' })
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [one, two],
      echoPost: true,
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByRole('button', { name: /clear completed/i }))
    await waitFor(() => expect(screen.getByText('2 tasks deleted')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => expect(screen.getByText('Completed (2)')).toBeInTheDocument())
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2)
  })
})

/**
 * A session can end while the board is open -- Google's sign-in lasts an hour unless renewed --
 * and every later request then comes back 401, or 499 for a script that asked not to be
 * redirected. That is "signed out", not a failure: the board says so and offers the way back in,
 * rather than showing an error message about the request that happened to notice.
 */
describe('an expired session', () => {
  it('shows a notice and the way back in when loading the board finds it gone', async () => {
    globalThis.fetch = mockApi({
      me: ALICE,
      providers: { enabled: true, providers: [GOOGLE] },
      tasks: 'error',
    }) as unknown as typeof fetch
    render(<App />)

    await waitFor(() => expect(screen.getByText(/your session has expired/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in with google/i })).toHaveAttribute('href', '/api/auth/login')
    expect(screen.queryByRole('button', { name: /add a task/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Unable to load tasks from the backend.')).not.toBeInTheDocument()
  })

  it('shows the notice when a change finds the session gone, not an error about the change', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      providers: { enabled: true, providers: [GOOGLE] },
      tasks: [task({ id: 7, description: 'Late night' })],
      put: { status: 499 },
    })
    await renderSignedIn(fetchMock)

    fireEvent.click(screen.getByLabelText('Mark "Late night" as done'))

    await waitFor(() => expect(screen.getByText(/your session has expired/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.queryByText('Unable to update task.')).not.toBeInTheDocument()
  })
})

describe('editing a task', () => {
  /** Opens a row's editor from its menu, as a user must. */
  function startEditing(description: string) {
    fireEvent.click(openMenu(description).getByRole('button', { name: /^edit$/i }))
    return within(screen.getByRole('form', { name: `Edit "${description}"` }))
  }

  it('saves a new description, due date and importance from the row menu', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 4, description: 'Renew the pasport' })],
      put: {
        status: 200,
        body: task({ id: 4, description: 'Renew the passport', dueDate: isoIn(5), importance: 'HIGH' }),
      },
    })
    await renderSignedIn(fetchMock)

    const editor = startEditing('Renew the pasport')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Renew the passport' } })
    fireEvent.change(editor.getByLabelText('Due date'), { target: { value: isoIn(5) } })
    fireEvent.change(editor.getByLabelText('Importance'), { target: { value: 'HIGH' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByLabelText('Mark "Renew the passport" as done')).toBeInTheDocument())
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(String(put?.[0])).toMatch(/\/api\/tasks\/4$/)
    expect(bodyOf(fetchMock, 'PUT')).toEqual({
      description: 'Renew the passport',
      dueDate: isoIn(5),
      importance: 'HIGH',
      state: 'TODO',
    })
    expect(screen.queryByRole('form', { name: /^edit/i })).not.toBeInTheDocument()
  })

  it('starts with the task as it is, and the caret in the description', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 5, description: 'Water the plants', importance: 'LOW' })] }))

    const editor = startEditing('Water the plants')

    expect(editor.getByLabelText('Description')).toHaveValue('Water the plants')
    expect(editor.getByLabelText('Due date')).toHaveValue(isoIn(1))
    expect(editor.getByLabelText('Importance')).toHaveValue('LOW')
    expect(editor.getByLabelText('Description')).toHaveFocus()
  })

  it('discards the changes on Cancel and on Escape, without asking the server', async () => {
    const fetchMock = mockApi({ me: ALICE, tasks: [task({ id: 6, description: 'Call the bank' })] })
    await renderSignedIn(fetchMock)

    let editor = startEditing('Call the bank')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Something else' } })
    fireEvent.click(editor.getByRole('button', { name: /cancel/i }))
    expect(screen.getByLabelText('Mark "Call the bank" as done')).toBeInTheDocument()

    editor = startEditing('Call the bank')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Something else' } })
    fireEvent.keyDown(editor.getByLabelText('Description'), { key: 'Escape' })
    expect(screen.getByLabelText('Mark "Call the bank" as done')).toBeInTheDocument()

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('will not save an empty description', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 7, description: 'Book the train' })] }))

    const editor = startEditing('Book the train')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: '   ' } })

    expect(editor.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('ignores Enter on an empty description too', async () => {
    const fetchMock = mockApi({ me: ALICE, tasks: [task({ id: 11, description: 'Book the hotel' })] })
    await renderSignedIn(fetchMock)

    startEditing('Book the hotel')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Edit "Book the hotel"' }))

    expect(screen.getByRole('form', { name: 'Edit "Book the hotel"' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('keeps an overdue date, which only a new task may not have', async () => {
    const fetchMock = mockApi({
      me: ALICE,
      tasks: [task({ id: 8, description: 'File the taxes', dueDate: isoIn(-3) })],
      put: { status: 200, body: task({ id: 8, description: 'File the 2025 taxes', dueDate: isoIn(-3) }) },
    })
    await renderSignedIn(fetchMock)

    const editor = startEditing('File the taxes')
    expect(editor.getByLabelText('Due date')).not.toHaveAttribute('min')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'File the 2025 taxes' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByLabelText('Mark "File the 2025 taxes" as done')).toBeInTheDocument())
    expect(bodyOf(fetchMock, 'PUT')).toMatchObject({ dueDate: isoIn(-3) })
  })

  it('keeps the editor and what was typed when the save fails', async () => {
    await renderSignedIn(
      mockApi({ me: ALICE, tasks: [task({ id: 9, description: 'Fix the bike' })], put: { status: 500 } }),
    )

    const editor = startEditing('Fix the bike')
    fireEvent.change(editor.getByLabelText('Description'), { target: { value: 'Fix the bike brakes' } })
    fireEvent.click(editor.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByText('Unable to update task.')).toBeInTheDocument())
    expect(screen.getByRole('form', { name: 'Edit "Fix the bike"' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toHaveValue('Fix the bike brakes')
  })

  it('offers no editing for a completed task', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 10, description: 'Paid the rent', state: 'DONE' })] }))

    expect(openMenu('Paid the rent').queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })
})

describe('picking a due date from the calendar', () => {
  /** The ISO date of `day` in the month that `iso` falls in. */
  function dayOfMonth(iso: string, day: number) {
    return `${iso.slice(0, 8)}${String(day).padStart(2, '0')}`
  }

  it('opens from the date field and sets the day picked', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 12, description: 'Plan the trip', dueDate: isoIn(1) })] }))
    fireEvent.click(openMenu('Plan the trip').getByRole('button', { name: /^edit$/i }))
    const editor = within(screen.getByRole('form', { name: 'Edit "Plan the trip"' }))

    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    fireEvent.click(editor.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await screen.findByRole('grid')
    fireEvent.click(within(calendar).getByText('15'))

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
    expect(editor.getByLabelText('Due date')).toHaveValue(dayOfMonth(isoIn(1), 15))
    expect(editor.getByRole('button', { name: /choose the due date from a calendar/i })).toHaveFocus()
  })

  it('closes on Escape without leaving the form or changing the date', async () => {
    await renderSignedIn(mockApi({ me: ALICE, tasks: [task({ id: 13, description: 'Book a table', dueDate: isoIn(2) })] }))
    fireEvent.click(openMenu('Book a table').getByRole('button', { name: /^edit$/i }))
    const editor = within(screen.getByRole('form', { name: 'Edit "Book a table"' }))

    fireEvent.click(editor.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await screen.findByRole('grid')
    fireEvent.keyDown(calendar, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
    expect(screen.getByRole('form', { name: 'Edit "Book a table"' })).toBeInTheDocument()
    expect(editor.getByLabelText('Due date')).toHaveValue(isoIn(2))
  })

  it('closes on a click outside it', async () => {
    await renderSignedIn(mockApi({ me: ALICE }))
    startAdding('Something new')

    fireEvent.click(screen.getByRole('button', { name: /choose the due date from a calendar/i }))
    await screen.findByRole('grid')
    fireEvent.click(document.body)

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
  })

  it('offers no day before today when adding, as the backend refuses one', async () => {
    await renderSignedIn(mockApi({ me: ALICE }))
    startAdding('Something new')

    fireEvent.click(screen.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await screen.findByRole('grid')

    const yesterday = within(calendar).queryByRole('button', { name: new RegExp(dayLabel(isoIn(-1))) })
    // Yesterday is only on screen when it falls in the month shown, which starts at tomorrow.
    if (yesterday) {
      expect(yesterday).toBeDisabled()
    }
    expect(within(calendar).getByRole('button', { name: new RegExp(dayLabel(isoIn(1))) })).toBeEnabled()
  })
})

/** The words react-day-picker puts in a day's label, e.g. "October 6th, 2026". */
function dayLabel(iso: string) {
  const [year, month, day] = iso.split('-').map(Number)
  const monthName = new Date(year, month - 1, day).toLocaleString('en-US', { month: 'long' })
  const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  return `${monthName} ${day}${suffix}, ${year}`
}
