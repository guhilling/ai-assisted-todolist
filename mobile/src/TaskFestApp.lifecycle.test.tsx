import { act, render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import type { BoardTask } from './api'
import type { SharedDraft } from './incoming'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, foreground, memoryBoard, memorySessions, tokenWith } from './testing'
import type { PickedFile } from './upload'
import { variantOf } from './variants'

/**
 * What the app leaves behind and lets overlap (#432): the picked files go from the phone once no
 * form holds them and no upload uses them, and of loads that overlap, only the latest one asked
 * for becomes the board.
 */

// Its own day, and Alice signed in on it, rather than the shared NOW and session.
const NOW = Date.UTC(2026, 9, 18, 9)
const idToken = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const task: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-18', importance: 'HIGH', state: 'TODO', attachments: [] }
const later: BoardTask = { id: 2, description: 'Book the train', dueDate: '2026-10-19', importance: 'LOW', state: 'TODO', attachments: [] }
const photo: PickedFile = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }

function attached(file: PickedFile, id: number) {
  return { id, fileName: file.name, contentType: file.type, sizeBytes: file.size, thumbnail: false }
}

/** One task without files, a photo to pick, and a backend without drafts. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue([task]),
    changes: {
      create: jest.fn((_caller, input) => Promise.resolve({ id: 5, attachments: [], ...input })),
      update: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(),
    },
    attachments: {
      link: jest.fn().mockResolvedValue('https://bucket.example.com/x'),
      remove: jest.fn(),
      upload: jest.fn((_caller, _taskId, file: PickedFile) => Promise.resolve(attached(file, 9))),
    },
    pickFile: jest.fn().mockResolvedValue(photo),
    forgetPicked: jest.fn().mockResolvedValue(undefined),
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    now: () => NOW,
    ...overrides,
  })
}

async function start(deps: Dependencies) {
  await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
  return userEvent.setup()
}

/** A promise and the means to settle it, for an answer the test lets arrive when it chooses. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (cause: unknown) => void = () => undefined
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('the picked files go from the phone once nothing needs them (#432)', () => {
  it("in the editor, once the file's upload is done", async () => {
    const upload = deferred<ReturnType<typeof attached>>()
    const deps = dependencies()
    jest.mocked(deps.attachments!.upload!).mockReturnValue(upload.promise)
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))

    await user.press(within(screen.getByTestId('task-form')).getByRole('button', { name: 'Take a photo' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalled())
    expect(deps.forgetPicked).not.toHaveBeenCalled()
    upload.resolve(attached(photo, 9))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('in the editor, when its upload failed too', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const deps = dependencies()
    jest.mocked(deps.attachments!.upload!).mockRejectedValue(new Error('storage down'))
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))

    await user.press(within(screen.getByTestId('task-form')).getByRole('button', { name: 'Take a photo' }))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('while adding a task, once it is attached to the task added', async () => {
    const deps = dependencies()
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = screen.getByTestId('task-form')
    await user.type(within(form).getByLabelText('What needs doing'), 'Pack')
    await user.press(within(form).getByRole('button', { name: 'Take a photo' }))
    await within(form).findByRole('button', { name: 'Remove photo.jpg' })
    expect(deps.forgetPicked).not.toHaveBeenCalled()

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), 5, photo, expect.any(Function)))
    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('while adding a task, when it is let go again', async () => {
    const deps = dependencies()
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = screen.getByTestId('task-form')
    await user.press(within(form).getByRole('button', { name: 'Take a photo' }))

    await user.press(await within(form).findByRole('button', { name: 'Remove photo.jpg' }))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('while adding a task, when the form is cancelled', async () => {
    const deps = dependencies()
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = screen.getByTestId('task-form')
    await user.press(within(form).getByRole('button', { name: 'Take a photo' }))
    await within(form).findByRole('button', { name: 'Remove photo.jpg' })

    await user.press(within(form).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('while adding a task, at once when it is refused', async () => {
    const empty: PickedFile = { ...photo, size: 0 }
    const deps = dependencies({ pickFile: jest.fn().mockResolvedValue(empty) })
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))

    await user.press(within(screen.getByTestId('task-form')).getByRole('button', { name: 'Take a photo' }))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([empty]))
  })

  it('while adding a task, when the form was closed before the file was picked', async () => {
    const picked = deferred<PickedFile | null>()
    const deps = dependencies({ pickFile: jest.fn().mockReturnValue(picked.promise) })
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = screen.getByTestId('task-form')
    await user.press(within(form).getByRole('button', { name: 'Take a photo' }))

    await user.press(within(form).getByRole('button', { name: 'Cancel' }))
    await act(async () => picked.resolve(photo))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('not while its upload to the draft is still on its way, though it was let go meanwhile', async () => {
    const upload = deferred<ReturnType<typeof attached>>()
    const deps = dependencies()
    deps.changes.drafts = {
      start: jest.fn().mockResolvedValue(77),
      add: jest.fn(),
      discard: jest.fn().mockResolvedValue(undefined),
    }
    jest.mocked(deps.attachments!.upload!).mockReturnValue(upload.promise)
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = screen.getByTestId('task-form')
    await user.press(within(form).getByRole('button', { name: 'Take a photo' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), 77, photo, expect.any(Function)))

    await user.press(within(form).getByRole('button', { name: 'Cancel' }))
    expect(deps.forgetPicked).not.toHaveBeenCalled()
    upload.resolve(attached(photo, 9))

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
  })

  it('not while its draft is still being started, though it was let go meanwhile', async () => {
    const draft = deferred<number>()
    const deps = dependencies()
    deps.changes.drafts = { start: jest.fn().mockReturnValue(draft.promise), add: jest.fn(), discard: jest.fn().mockResolvedValue(undefined) }
    const user = await start(deps)
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = screen.getByTestId('task-form')
    await user.press(within(form).getByRole('button', { name: 'Take a photo' }))
    await waitFor(() => expect(deps.changes.drafts!.start).toHaveBeenCalled())

    await user.press(within(form).getByRole('button', { name: 'Remove photo.jpg' }))
    expect(deps.forgetPicked).not.toHaveBeenCalled()
    draft.resolve(77)

    await waitFor(() => expect(deps.forgetPicked).toHaveBeenCalledWith([photo]))
    // Uploaded from the file still there, then taken off the draft again, as before #432.
    expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), 77, photo, expect.any(Function))
  })

  it("leaves a share's files to the share", async () => {
    const shared: PickedFile = { uri: 'file:///cache/shared/1-scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }
    const share: SharedDraft = { description: 'Read this', files: [shared], refused: [] }
    const incoming = { take: jest.fn().mockResolvedValueOnce(share).mockResolvedValue(null), forget: jest.fn().mockResolvedValue(undefined) }
    const deps = dependencies({ incoming })
    const user = await start(deps)
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(incoming.forget).toHaveBeenCalledWith([shared]))
    expect(deps.forgetPicked).not.toHaveBeenCalled()
  })
})

describe('loads that overlap (#432)', () => {
  it('show the latest one asked for, not the last one to answer, and keep it', async () => {
    const comeBack = foreground()
    const first = deferred<BoardTask[]>()
    const second = deferred<BoardTask[]>()
    const keptBoard = memoryBoard(null)
    const fetchTasks = jest.fn().mockResolvedValueOnce([task]).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    await start(dependencies({ fetchTasks, keptBoard }))
    await screen.findByText('Water the plants')

    await comeBack()
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2))
    await comeBack()
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(3))
    second.resolve([task, later])
    await screen.findByText('Book the train')
    first.resolve([task])
    await first.promise

    // The older answer, arriving last, changes nothing.
    await waitFor(() => expect(keptBoard.current()?.tasks).toEqual([task, later]))
    expect(screen.getByText('Book the train')).toBeOnTheScreen()
  })

  it('leave the latest board shown when an older one fails late', async () => {
    const comeBack = foreground()
    const first = deferred<BoardTask[]>()
    const fetchTasks = jest.fn().mockResolvedValueOnce([task]).mockReturnValueOnce(first.promise).mockResolvedValueOnce([task, later])
    await start(dependencies({ fetchTasks }))
    await screen.findByText('Water the plants')

    await comeBack()
    await waitFor(() => expect(fetchTasks).toHaveBeenCalledTimes(2))
    await comeBack()
    await screen.findByText('Book the train')
    await act(async () => {
      first.reject(new TypeError('Network request failed'))
      await first.promise.catch(() => undefined)
    })

    expect(screen.queryByText(/^No connection\./)).toBeNull()
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeOnTheScreen()
  })
})
