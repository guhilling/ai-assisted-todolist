import { act, render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { SignedOutError, type BoardTask } from './api'
import type { SharedDraft } from './incoming'
import type { KeptBoardStore } from './keptBoard'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import type { PickedFile } from './upload'
import { variantOf } from './variants'

/**
 * Sharing into TaskFest (#355): what another app shared opens "Add a task", filled in, once the
 * board can take it -- and the copies of the shared files go once the task is added or the form
 * closed.
 */

const NOW = Date.UTC(2026, 9, 20, 9)
const HOUR = 3600 * 1000
const idToken = `h.${btoa(JSON.stringify({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })).replace(/=+$/, '')}.s`
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const task: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-20', importance: 'HIGH', state: 'TODO', attachments: [] }
const scan: PickedFile = { uri: 'file:///cache/shared/1-scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }
const share: SharedDraft = { description: 'Read the article https://example.com/a', files: [scan], refused: [] }

function memorySessions(initial: Session | null): SessionStore {
  let stored = initial
  return { save: async (next) => void (stored = next), load: async () => stored, clear: async () => void (stored = null) }
}

/** A phone that has a share waiting, taken once. */
function sharing(...drafts: (SharedDraft | null)[]) {
  const take = jest.fn().mockResolvedValue(null)
  for (const draft of drafts) {
    take.mockResolvedValueOnce(draft)
  }
  return { take, forget: jest.fn().mockResolvedValue(undefined) }
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(session),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([task]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: {
      create: jest.fn((_caller, input) => Promise.resolve({ id: 2, attachments: [], ...input })),
      update: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(),
    },
    attachments: {
      link: jest.fn().mockResolvedValue('https://bucket.example.com/x'),
      remove: jest.fn(),
      upload: jest.fn((_caller, _taskId, file: PickedFile) =>
        Promise.resolve({ id: 9, fileName: file.name, contentType: file.type, sizeBytes: file.size, thumbnail: false }),
      ),
    },
    pickFile: jest.fn(),
    documents: { open: jest.fn(), forget: jest.fn().mockResolvedValue(undefined) },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    incoming: sharing(share),
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
}

async function start(deps: Dependencies) {
  await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
  return userEvent.setup()
}

describe('a share opens "Add a task" (#355)', () => {
  it('filled in: the text as the description, the files waiting to be attached', async () => {
    await start(dependencies())

    const form = await screen.findByTestId('task-form')
    expect(within(form).getByText('Add a task')).toBeOnTheScreen()
    expect(within(form).getByDisplayValue('Read the article https://example.com/a')).toBeOnTheScreen()
    expect(within(form).getByRole('button', { name: 'Remove scan.pdf' })).toBeOnTheScreen()
  })

  it('adds the task with the files, and then forgets the copies', async () => {
    const deps = dependencies()
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.queryByTestId('task-form')).toBeNull())
    expect(deps.changes.create).toHaveBeenCalledWith(
      expect.objectContaining({ idToken }),
      expect.objectContaining({ description: 'Read the article https://example.com/a', state: 'TODO' }),
    )
    expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), 2, scan, expect.any(Function))
    expect(deps.incoming!.forget).toHaveBeenCalledWith([scan])
  })

  it('forgets the copies when the form is cancelled, even of a file removed from it first', async () => {
    const deps = dependencies()
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Remove scan.pdf' }))
    await user.press(within(form).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(deps.incoming!.forget).toHaveBeenCalledWith([scan]))
    expect(deps.changes.create).not.toHaveBeenCalled()
  })

  it('forgets the copies when the session ends while the task is added', async () => {
    const deps = dependencies()
    jest.mocked(deps.changes.create).mockRejectedValue(new SignedOutError())
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(deps.incoming!.forget).toHaveBeenCalledWith([scan])
  })

  it("says which files were not taken, in the website's words", async () => {
    const draft: SharedDraft = {
      description: '',
      files: [scan],
      refused: [
        { name: 'notes.docx', refusal: 'UNSUPPORTED_TYPE' },
        { name: 'third.png', refusal: 'TASK_FULL' },
        { name: 'gone.pdf', refusal: 'UNREADABLE' },
      ],
    }
    await start(dependencies({ incoming: sharing(draft) }))

    const form = await screen.findByTestId('task-form')
    expect(within(form).getByText(/notes\.docx is neither a PDF nor an image\./)).toBeOnTheScreen()
    expect(within(form).getByText(/third\.png was not attached: this task already holds as many attachments as it can\./)).toBeOnTheScreen()
    expect(within(form).getByText(/gone\.pdf could not be read\./)).toBeOnTheScreen()
  })

  it('keeps the copies until their upload is done, even when the form is closed meanwhile', async () => {
    let uploaded: () => void = () => undefined
    const deps = dependencies()
    deps.attachments!.upload = jest.fn(
      (_caller, _taskId, file: PickedFile) =>
        new Promise((resolve) => (uploaded = () => resolve({ id: 9, fileName: file.name, contentType: file.type, sizeBytes: file.size, thumbnail: false }))),
    )
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')
    await user.press(within(form).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalled())

    await user.press(within(form).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('task-form')).toBeNull())
    expect(deps.incoming!.forget).not.toHaveBeenCalled()
    await act(async () => uploaded())

    await waitFor(() => expect(deps.incoming!.forget).toHaveBeenCalledWith([scan]))
    expect(deps.incoming!.forget).toHaveBeenCalledTimes(1)
  })

  it('opens a second share once the first is done with, rather than dropping either', async () => {
    const photo: PickedFile = { uri: 'file:///cache/shared/2-photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 1_000 }
    const second: SharedDraft = { description: 'Second', files: [photo], refused: [] }
    const deps = dependencies({ sessions: memorySessions(null), incoming: sharing(share, second) })
    deps.provider.signIn = jest.fn().mockResolvedValue({ idToken, refreshToken: 'r' })
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    const user = await start(deps)
    await screen.findByRole('button', { name: 'Sign in with Keycloak' })
    await act(async () => onChange('active'))

    await user.press(screen.getByRole('button', { name: 'Sign in with Keycloak' }))
    expect(await within(await screen.findByTestId('task-form')).findByRole('button', { name: 'Remove scan.pdf' })).toBeOnTheScreen()
    await user.press(within(screen.getByTestId('task-form')).getByRole('button', { name: 'Cancel' }))

    expect(await within(await screen.findByTestId('task-form')).findByRole('button', { name: 'Remove photo.jpg' })).toBeOnTheScreen()
    jest.restoreAllMocks()
  })

  it('opens the second share with its own text, not the first one’s', async () => {
    const second: SharedDraft = { description: 'Second', files: [], refused: [] }
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    const user = await start(dependencies({ incoming: sharing(share, second) }))
    let form = await screen.findByTestId('task-form')
    await act(async () => onChange('active'))
    await user.clear(within(form).getByDisplayValue('Read the article https://example.com/a'))
    await user.type(within(form).getByLabelText('What needs doing'), 'Changed')
    await user.press(within(form).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(within(screen.getByTestId('task-form')).getByDisplayValue('Second')).toBeOnTheScreen())
    form = screen.getByTestId('task-form')
    expect(within(form).queryByDisplayValue('Changed')).toBeNull()
    jest.restoreAllMocks()
  })

  it('opens nothing when nothing was shared', async () => {
    const deps = dependencies({ incoming: sharing(null) })
    await start(deps)

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByTestId('task-form')).toBeNull()
  })

  it('opens nothing, and the board stays, when the share could not be read', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const incoming = { take: jest.fn().mockRejectedValue(new Error('gone')), forget: jest.fn() }
    await start(dependencies({ incoming }))

    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByTestId('task-form')).toBeNull()
    expect(warn).toHaveBeenCalledWith('What was shared could not be read', expect.any(Error))
    warn.mockRestore()
  })
})

describe('a share waits until the board can take it (#355)', () => {
  it('while signed out: it opens once signed in', async () => {
    const deps = dependencies({
      sessions: memorySessions(null),
      provider: { signIn: jest.fn().mockResolvedValue({ idToken, refreshToken: 'r' }), refresh: jest.fn() },
    })
    const user = await start(deps)

    await user.press(await screen.findByRole('button', { name: 'Sign in with Keycloak' }))

    expect(await within(await screen.findByTestId('task-form')).findByRole('button', { name: 'Remove scan.pdf' })).toBeOnTheScreen()
  })

  it('while the board shown is the one kept on the phone: it opens once the current one is there', async () => {
    let loaded: (tasks: BoardTask[]) => void = () => undefined
    const keptBoard: KeptBoardStore = {
      load: jest.fn().mockResolvedValue({ account: 'alice@example.com', savedAt: NOW - HOUR, tasks: [task] }),
      save: jest.fn().mockResolvedValue(undefined),
      clear: jest.fn().mockResolvedValue(undefined),
    }
    const fetchTasks = jest.fn(() => new Promise<BoardTask[]>((resolve) => (loaded = resolve)))
    await start(dependencies({ keptBoard, fetchTasks }))
    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByTestId('task-form')).toBeNull()

    await act(async () => loaded([task]))

    expect(await screen.findByTestId('task-form')).toBeOnTheScreen()
  })

  it('while a task is being edited: it opens once the editor is closed', async () => {
    let shared: (draft: SharedDraft) => void = () => undefined
    const incoming = { take: jest.fn(() => new Promise<SharedDraft | null>((resolve) => (shared = resolve))), forget: jest.fn() }
    const user = await start(dependencies({ incoming }))
    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))
    expect(within(await screen.findByTestId('task-form')).getByText('Edit "Water the plants"')).toBeOnTheScreen()

    await act(async () => shared(share))
    expect(within(screen.getByTestId('task-form')).queryByRole('button', { name: 'Remove scan.pdf' })).toBeNull()
    await user.press(within(screen.getByTestId('task-form')).getByRole('button', { name: 'Cancel' }))

    expect(await within(await screen.findByTestId('task-form')).findByRole('button', { name: 'Remove scan.pdf' })).toBeOnTheScreen()
  })
})

describe('a share while the app runs (#355)', () => {
  afterEach(() => jest.restoreAllMocks())

  it('is taken when the app comes back to the foreground', async () => {
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    const deps = dependencies({ incoming: sharing(null, share) })
    await start(deps)
    expect(await screen.findByText('Water the plants')).toBeOnTheScreen()
    expect(screen.queryByTestId('task-form')).toBeNull()

    await act(async () => onChange('active'))

    expect(await within(await screen.findByTestId('task-form')).findByRole('button', { name: 'Remove scan.pdf' })).toBeOnTheScreen()
    expect(deps.incoming!.take).toHaveBeenCalledTimes(2)
  })
})
