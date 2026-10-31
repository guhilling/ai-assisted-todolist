import { act, render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { SignedOutError, type BoardTask } from './api'
import type { SharedDraft } from './incoming'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, memoryBoard, memorySessions, tokenWith } from './testing'
import { variantOf } from './variants'

/**
 * Links on tasks (#414): a link shared into the app waits in "Add a task", titled by the page, and
 * is added to the task with it; on the board, a link is listed by its title and opens its address
 * in the browser -- never through a storage link, and never one that is no web address.
 */

// Its own day, and Alice signed in on it, rather than the shared NOW and session.
const NOW = Date.UTC(2026, 9, 30, 9)
const idToken = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const ARTICLE = 'https://example.com/articles/42'
const link = { id: 9, fileName: 'An article worth reading', contentType: 'text/uri-list', sizeBytes: 0, thumbnail: false, url: ARTICLE }
const task: BoardTask = { id: 1, description: 'Read later', dueDate: '2026-10-30', importance: 'HIGH', state: 'TODO', attachments: [link] }
const shared: SharedDraft = {
  description: 'An article worth reading',
  files: [],
  links: [{ url: ARTICLE, title: 'An article worth reading' }],
  refused: [],
}

/** One task with a link on it, and a backend that adds links. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue([task]),
    changes: {
      create: jest.fn((_caller, input) => Promise.resolve({ id: 2, attachments: [], ...input })),
      update: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(),
    },
    attachments: {
      link: jest.fn().mockResolvedValue('https://bucket.example.com/x'),
      remove: jest.fn(),
      addLink: jest.fn((_caller, _taskId, added: { url: string; title: string | null }) =>
        Promise.resolve({ ...link, id: 10, fileName: added.title ?? added.url, url: added.url }),
      ),
    },
    documents: { open: jest.fn(), forget: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    now: () => NOW,
    ...overrides,
  })
}

async function start(deps: Dependencies) {
  await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
  return userEvent.setup()
}

const sharing = (draft: SharedDraft) => ({
  take: jest.fn().mockResolvedValueOnce(draft).mockResolvedValue(null),
  forget: jest.fn().mockResolvedValue(undefined),
})

afterEach(() => {
  jest.clearAllMocks()
  jest.restoreAllMocks()
})

describe('a link on a task (#414)', () => {
  it('is listed by its title and opens its address in the browser, asking for no storage link', async () => {
    const opened = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const deps = dependencies()
    const user = await start(deps)

    await user.press(await screen.findByRole('button', { name: 'Open An article worth reading' }))

    expect(opened).toHaveBeenCalledWith(ARTICLE)
    expect(deps.attachments!.link).not.toHaveBeenCalled()
    expect(deps.documents!.open).not.toHaveBeenCalled()
  })

  it('says so when the browser cannot open it', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no browser'))
    const user = await start(dependencies())

    await user.press(await screen.findByRole('button', { name: 'Open An article worth reading' }))

    expect(await screen.findByText('Unable to open the link.')).toBeOnTheScreen()
  })

  it('is not opened when its address is no web address', async () => {
    const opened = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
    const user = await start(dependencies({ fetchTasks: jest.fn().mockResolvedValue([{ ...task, attachments: [{ ...link, url: 'javascript:alert(1)' }] }]) }))

    await user.press(await screen.findByRole('button', { name: 'Open An article worth reading' }))

    expect(opened).not.toHaveBeenCalled()
  })
})

describe('a shared link (#414)', () => {
  it('waits in "Add a task", titled by the page, with the title as the description', async () => {
    await start(dependencies({ incoming: sharing(shared) }))

    const form = await screen.findByTestId('task-form')
    expect(within(form).getByDisplayValue('An article worth reading')).toBeOnTheScreen()
    expect(within(form).getByRole('button', { name: 'Remove An article worth reading' })).toBeOnTheScreen()
  })

  it('is added to the task once it exists, and shown on it', async () => {
    const deps = dependencies({ incoming: sharing(shared) })
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.queryByTestId('task-form')).toBeNull())
    expect(deps.attachments!.addLink).toHaveBeenCalledWith(
      expect.objectContaining({ idToken }),
      2,
      { url: ARTICLE, title: 'An article worth reading' },
    )
    expect(await screen.findAllByRole('button', { name: 'Open An article worth reading' })).toHaveLength(2)
  })

  it('is not added once removed from the form', async () => {
    const deps = dependencies({ incoming: sharing(shared) })
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Remove An article worth reading' }))
    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.queryByTestId('task-form')).toBeNull())
    expect(deps.attachments!.addLink).not.toHaveBeenCalled()
  })

  it('without a title, waits under its address, with the description left to the user', async () => {
    await start(dependencies({ incoming: sharing({ ...shared, description: '', links: [{ url: ARTICLE, title: null }] }) }))

    const form = await screen.findByTestId('task-form')
    expect(within(form).getByRole('button', { name: `Remove ${ARTICLE}` })).toBeOnTheScreen()
  })
})

describe('a link answered after a sign-out (#428)', () => {
  // Bea's task has the id Alice's new one was given: a late answer would land on it.
  const beas: BoardTask = { id: 2, description: 'Call the bank', dueDate: '2026-10-31', importance: 'LOW', state: 'TODO', attachments: [] }
  const beasToken = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'bea@example.com' })

  /** Alice's board, and Bea's once Alice has signed out and Bea signed in. */
  function twoAccounts(overrides: Partial<Dependencies> = {}) {
    return dependencies({
      incoming: sharing(shared),
      keptBoard: memoryBoard(null),
      fetchTasks: jest.fn().mockResolvedValueOnce([task]).mockResolvedValue([beas]),
      provider: { signIn: jest.fn().mockResolvedValue({ idToken: beasToken, refreshToken: 'b' }), refresh: jest.fn() },
      ...overrides,
    })
  }

  /** Alice cancels the form, signs out, and Bea signs in. */
  async function switchToBea(user: ReturnType<typeof userEvent.setup>) {
    await user.press(within(screen.getByTestId('task-form')).getByRole('button', { name: 'Cancel' }))
    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))
    await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))
    await screen.findByText('Call the bank')
  }

  it('is added to no task of whoever signed in next', async () => {
    let answer: () => void = () => undefined
    const addLink = jest.fn(() => new Promise<typeof link>((resolve) => (answer = () => resolve({ ...link, id: 10 }))))
    const deps = twoAccounts()
    const keptBoard = deps.keptBoard
    deps.attachments!.addLink = addLink
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(addLink).toHaveBeenCalled())
    await switchToBea(user)
    const kept = (keptBoard.save as jest.Mock).mock.calls.length
    await act(async () => answer())

    expect(within(screen.getByTestId('task-2')).queryByRole('button', { name: 'Open An article worth reading' })).toBeNull()
    expect(keptBoard.save).toHaveBeenCalledTimes(kept)
  })

  it('does not sign whoever signed in next out when it says the session had ended', async () => {
    let refuse: () => void = () => undefined
    const deps = twoAccounts()
    deps.attachments!.addLink = jest.fn(() => new Promise<typeof link>((_resolve, reject) => (refuse = () => reject(new SignedOutError()))))
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(deps.attachments!.addLink).toHaveBeenCalled())
    await switchToBea(user)
    await act(async () => refuse())

    expect(screen.getByText('Call the bank')).toBeOnTheScreen()
    expect(screen.queryByText('Your session has expired. Sign in again to carry on.')).toBeNull()
  })

  it('is not sent as whoever signed in next while a file before it was still going up', async () => {
    const photo = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }
    let uploaded: () => void = () => undefined
    const deps = twoAccounts({ incoming: sharing({ ...shared, files: [photo] }) })
    deps.attachments!.upload = jest.fn(
      () => new Promise((resolve) => (uploaded = () => resolve({ id: 11, fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000, thumbnail: false }))),
    )
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalled())
    await switchToBea(user)
    await act(async () => uploaded())

    expect(deps.attachments!.addLink).not.toHaveBeenCalled()
  })
})
