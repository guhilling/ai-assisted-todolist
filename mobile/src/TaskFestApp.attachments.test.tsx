import { act, render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { TimedOutError, type BoardTask } from './api'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variantOf } from './variants'

/**
 * A task's files in the app (#274), as on the website: an image as a small preview on its row, a
 * PDF by its name, each opening when tapped -- an image in the app, a PDF in the phone's viewer --
 * and each removable from the editor while the task is open.
 */

const NOW = Date.UTC(2026, 9, 18, 9)
const HOUR = 3600 * 1000

const photo = { id: 3, fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000, thumbnail: true }
const sketch = { id: 4, fileName: 'sketch.png', contentType: 'image/png', sizeBytes: 30_000, thumbnail: false }
const scan = { id: 5, fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 90_000, thumbnail: false }

const withFiles: BoardTask = {
  id: 1,
  description: 'Water the plants',
  dueDate: '2026-10-18',
  importance: 'HIGH',
  state: 'TODO',
  attachments: [photo, scan],
}

function memorySessions(initial: Session | null): SessionStore {
  let stored = initial
  return {
    save: async (next) => void (stored = next),
    load: async () => stored,
    clear: async () => void (stored = null),
  }
}

const idToken = `h.${btoa(JSON.stringify({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })).replace(/=+$/, '')}.s`
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

/** Links as the backend signs them: one per file, another for its thumbnail. */
function linkTo(_caller: unknown, taskId: number, attachmentId: number, thumbnail: boolean) {
  const which = thumbnail ? 'thumbnail' : 'file'
  return Promise.resolve(`https://bucket.example.com/${taskId}/${attachmentId}/${which}`)
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(session),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([withFiles]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    attachments: { link: jest.fn(linkTo), remove: jest.fn().mockResolvedValue(undefined) },
    documents: { open: jest.fn().mockResolvedValue(undefined), forget: jest.fn().mockResolvedValue(undefined) },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
}

const dev = variantOf('dev', {})

function show(deps: Dependencies) {
  return render(<TaskFestApp variant={dev} language="en" dependencies={deps} />)
}

describe("a task's files on the board (#274)", () => {
  it("shows an image by its thumbnail and a PDF by its name, on the task's row", async () => {
    const deps = dependencies()
    await show(deps)

    const row = await screen.findByTestId('task-1')
    const preview = await within(row).findByTestId('preview-3')
    expect(preview).toHaveProp('source', { uri: 'https://bucket.example.com/1/3/thumbnail' })
    expect(within(row).getByRole('button', { name: 'Open photo.jpg' })).toBeOnTheScreen()
    expect(within(row).getByRole('button', { name: 'Open scan.pdf' })).toBeOnTheScreen()
    expect(within(row).getByText('scan.pdf')).toBeOnTheScreen()
  })

  it('shows an image without a thumbnail by the file itself', async () => {
    await show(dependencies({ fetchTasks: jest.fn().mockResolvedValue([{ ...withFiles, attachments: [sketch] }]) }))

    expect(await screen.findByTestId('preview-4')).toHaveProp('source', { uri: 'https://bucket.example.com/1/4/file' })
  })

  it('falls back to the file when the thumbnail cannot be had', async () => {
    const link = jest.fn((caller: unknown, taskId: number, attachmentId: number, thumbnail: boolean) =>
      thumbnail ? Promise.reject(new Error('gone')) : linkTo(caller, taskId, attachmentId, thumbnail),
    )
    await show(dependencies({ attachments: { link, remove: jest.fn() } }))

    await waitFor(() => expect(screen.getByTestId('preview-3')).toHaveProp('source', { uri: 'https://bucket.example.com/1/3/file' }))
  })

  it('asks for a preview once while its link is fresh, however often the board is drawn', async () => {
    const deps = dependencies()
    await show(deps)
    await screen.findByTestId('preview-3')

    await act(async () => screen.rerender(<TaskFestApp variant={dev} language="de" dependencies={deps} />))
    await screen.findByTestId('preview-3')

    const previews = (deps.attachments!.link as jest.Mock).mock.calls.filter(([, , id, thumbnail]) => id === 3 && thumbnail)
    expect(previews).toHaveLength(1)
  })

  it('opens an image in the app, full size, and closes it again', async () => {
    await show(dependencies())
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Open photo.jpg' }))

    const viewer = await screen.findByTestId('file-viewer')
    expect(within(viewer).getByTestId('viewed-image')).toHaveProp('source', { uri: 'https://bucket.example.com/1/3/file' })
    expect(within(viewer).getByLabelText('photo.jpg')).toBeOnTheScreen()
    await user.press(within(viewer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('file-viewer')).toBeNull()
  })

  it('opens an image without a thumbnail by the link its preview already has', async () => {
    const deps = dependencies({ fetchTasks: jest.fn().mockResolvedValue([{ ...withFiles, attachments: [sketch] }]) })
    await show(deps)
    await screen.findByTestId('preview-4')

    await userEvent.setup().press(screen.getByRole('button', { name: 'Open sketch.png' }))

    expect(await screen.findByTestId('viewed-image')).toHaveProp('source', { uri: 'https://bucket.example.com/1/4/file' })
    expect(deps.attachments!.link).toHaveBeenCalledTimes(1)
  })

  it("opens a PDF in the phone's own viewer, by its own type", async () => {
    const documents = { open: jest.fn().mockResolvedValue(undefined), forget: jest.fn() }
    await show(dependencies({ documents }))

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Open scan.pdf' }))

    await waitFor(() =>
      expect(documents.open).toHaveBeenCalledWith('https://bucket.example.com/1/5/file', 'scan.pdf', 'application/pdf'),
    )
  })

  it('opens a file once, however often it is tapped while its link is on its way', async () => {
    let answer: (url: string) => void = () => undefined
    const link = jest.fn((caller: unknown, taskId: number, attachmentId: number, thumbnail: boolean) =>
      thumbnail ? linkTo(caller, taskId, attachmentId, thumbnail) : new Promise<string>((resolve) => (answer = resolve)),
    )
    const documents = { open: jest.fn().mockResolvedValue(undefined), forget: jest.fn() }
    await show(dependencies({ attachments: { link, remove: jest.fn() }, documents }))
    const user = userEvent.setup()
    const open = await screen.findByRole('button', { name: 'Open scan.pdf' })

    await user.press(open)
    await user.press(open)
    await act(async () => answer('https://bucket.example.com/1/5/file'))

    expect(documents.open).toHaveBeenCalledTimes(1)
  })

  it('does not reload the board, or refuse changes, when a file could not be had', async () => {
    const fetchTasks = jest.fn().mockResolvedValue([withFiles])
    const link = jest.fn((caller: unknown, taskId: number, attachmentId: number, thumbnail: boolean) =>
      thumbnail ? linkTo(caller, taskId, attachmentId, thumbnail) : Promise.reject(new TimedOutError(10_000)),
    )
    await show(dependencies({ fetchTasks, attachments: { link, remove: jest.fn() } }))
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Open scan.pdf' }))
    await screen.findByText('Unable to open the file.')
    await user.press(screen.getByRole('button', { name: 'Edit "Water the plants"' }))

    expect(fetchTasks).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('task-form')).toBeOnTheScreen()
  })

  it('leaves nothing of the files behind when the session ends', async () => {
    const deps = dependencies()
    await show(deps)
    const user = userEvent.setup()
    await user.press(await screen.findByRole('button', { name: 'Open photo.jpg' }))
    await screen.findByTestId('file-viewer')

    await user.press(screen.getByRole('button', { name: 'Close' }))
    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByRole('button', { name: 'Sign in with Keycloak' })).toBeOnTheScreen()
    expect(deps.documents!.forget).toHaveBeenCalled()
  })

  it('says so when a file cannot be opened', async () => {
    const link = jest.fn((caller: unknown, taskId: number, attachmentId: number, thumbnail: boolean) =>
      thumbnail ? linkTo(caller, taskId, attachmentId, thumbnail) : Promise.reject(new Error('offline')),
    )
    await show(dependencies({ attachments: { link, remove: jest.fn() } }))

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Open scan.pdf' }))

    expect(await screen.findByText('Unable to open the file.')).toBeOnTheScreen()
  })
})

describe("removing a task's files, in its editor (#274)", () => {
  it('lists the files and removes one for good, from the editor and the row', async () => {
    const deps = dependencies()
    await show(deps)
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(await screen.findByRole('button', { name: 'Remove scan.pdf' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove scan.pdf' })).toBeNull())
    expect(deps.attachments!.remove).toHaveBeenCalledWith(expect.objectContaining({ idToken }), 1, 5)
    expect(screen.getByRole('button', { name: 'Remove photo.jpg' })).toBeOnTheScreen()
    await user.press(screen.getByRole('button', { name: 'Cancel' }))
    expect(within(screen.getByTestId('task-1')).queryByText('scan.pdf')).toBeNull()
  })

  it('keeps the board on the phone without the file removed', async () => {
    const deps = dependencies()
    await show(deps)
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(await screen.findByRole('button', { name: 'Remove scan.pdf' }))

    await waitFor(() =>
      expect(deps.keptBoard.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ tasks: [expect.objectContaining({ id: 1, attachments: [photo] })] }),
      ),
    )
  })

  it("keeps a completed task's files: they may only be opened", async () => {
    await show(dependencies({ fetchTasks: jest.fn().mockResolvedValue([{ ...withFiles, state: 'DONE' }]) }))

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))

    const editor = await screen.findByTestId('task-form')
    expect(within(editor).getByText('scan.pdf')).toBeOnTheScreen()
    expect(within(editor).queryByRole('button', { name: 'Remove scan.pdf' })).toBeNull()
  })

  it('says so, and keeps the file, when it could not be removed', async () => {
    const remove = jest.fn().mockRejectedValue(new Error('backend down'))
    await show(dependencies({ attachments: { link: jest.fn(linkTo), remove } }))
    const user = userEvent.setup()

    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))
    await user.press(await screen.findByRole('button', { name: 'Remove scan.pdf' }))

    expect(await screen.findByText('Unable to remove the file.')).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: 'Remove scan.pdf' })).toBeOnTheScreen()
  })
})
