import { act, render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { AppState } from 'react-native'
import { AttachmentRefusedError, type BoardTask } from './api'
import { CameraRefusedError } from './pick'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import type { PickedFile } from './upload'
import { variantOf } from './variants'

/**
 * Attaching files from the phone (#274), as the website does: a photo taken or chosen, or any file,
 * in a task's editor -- or while adding one, held until the task exists. Progress while it goes,
 * and the website's words when a file is refused.
 */

const NOW = Date.UTC(2026, 9, 18, 9)
const HOUR = 3600 * 1000
const idToken = `h.${btoa(JSON.stringify({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })).replace(/=+$/, '')}.s`
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const task: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-18', importance: 'HIGH', state: 'TODO', attachments: [] }
const photo: PickedFile = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }
const scan: PickedFile = { uri: 'file:///cache/scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }

function attached(file: PickedFile, id: number) {
  return { id, fileName: file.name, contentType: file.type, sizeBytes: file.size, thumbnail: false }
}

function memorySessions(initial: Session | null): SessionStore {
  let stored = initial
  return { save: async (next) => void (stored = next), load: async () => stored, clear: async () => void (stored = null) }
}

function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    sessions: memorySessions(session),
    provider: { signIn: jest.fn(), refresh: jest.fn() },
    fetchTasks: jest.fn().mockResolvedValue([task]),
    fetchMinimumAppVersion: jest.fn().mockResolvedValue('0.0.0'),
    changes: { create: jest.fn(), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    attachments: {
      link: jest.fn().mockResolvedValue('https://bucket.example.com/x'),
      remove: jest.fn(),
      upload: jest.fn((_caller, _taskId, file: PickedFile) => Promise.resolve(attached(file, 9))),
    },
    pickFile: jest.fn().mockResolvedValue(photo),
    documents: { open: jest.fn(), forget: jest.fn().mockResolvedValue(undefined) },
    deleteAccount: jest.fn(),
    keptBoard: { load: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    appVersion: '1.2.0',
    now: () => NOW,
    ...overrides,
  }
}

async function editTask(deps: Dependencies) {
  await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
  const user = userEvent.setup()
  await user.press(await screen.findByRole('button', { name: 'Edit "Water the plants"' }))
  return { user, editor: await screen.findByTestId('task-form') }
}

describe('attaching a file in the editor (#274)', () => {
  it('offers the camera, the photo library and the files, with the limits', async () => {
    const { editor } = await editTask(dependencies())

    expect(within(editor).getByRole('button', { name: 'Take a photo' })).toBeOnTheScreen()
    expect(within(editor).getByRole('button', { name: 'Choose a photo' })).toBeOnTheScreen()
    expect(within(editor).getByRole('button', { name: 'Choose a file' })).toBeOnTheScreen()
    expect(within(editor).getByText('PDF or image, up to 10 MB · 2 per task, 5 in all')).toBeOnTheScreen()
  })

  it('takes a photo and attaches it: in the editor and on the board', async () => {
    const deps = dependencies()
    const { user, editor } = await editTask(deps)

    await user.press(within(editor).getByRole('button', { name: 'Take a photo' }))

    expect(await within(editor).findByText('photo.jpg')).toBeOnTheScreen()
    expect(deps.pickFile).toHaveBeenCalledWith('camera')
    expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.objectContaining({ idToken }), 1, photo, expect.any(Function))
    await user.press(within(editor).getByRole('button', { name: 'Cancel' }))
    expect(within(screen.getByTestId('task-1')).getByRole('button', { name: 'Open photo.jpg' })).toBeOnTheScreen()
  })

  it('says how far the upload has got', async () => {
    let progress: (fraction: number) => void = () => undefined
    let done: () => void = () => undefined
    const upload = jest.fn((_caller, _taskId, file: PickedFile, onProgress: (fraction: number) => void) => {
      progress = onProgress
      return new Promise<ReturnType<typeof attached>>((resolve) => (done = () => resolve(attached(file, 9))))
    })
    const deps = dependencies({ attachments: { link: jest.fn(), remove: jest.fn(), upload } })
    const { user, editor } = await editTask(deps)

    await user.press(within(editor).getByRole('button', { name: 'Choose a file' }))
    await act(async () => progress(0.42))

    expect(within(editor).getByText('Uploading photo.jpg')).toBeOnTheScreen()
    expect(within(editor).getByText('42%')).toBeOnTheScreen()
    await act(async () => done())
    expect(within(editor).queryByText('Uploading photo.jpg')).toBeNull()
  })

  it("says why a file was refused, in the website's words", async () => {
    const upload = jest.fn().mockRejectedValue(new AttachmentRefusedError('USER_FULL'))
    const { user, editor } = await editTask(dependencies({ attachments: { link: jest.fn(), remove: jest.fn(), upload } }))

    await user.press(within(editor).getByRole('button', { name: 'Choose a photo' }))

    expect(
      await within(editor).findByText('photo.jpg was not attached: you already have as many attachments as you can. Remove one first.'),
    ).toBeOnTheScreen()
  })

  it('says so when a file could not be uploaded', async () => {
    const upload = jest.fn().mockRejectedValue(new Error('offline'))
    const { user, editor } = await editTask(dependencies({ attachments: { link: jest.fn(), remove: jest.fn(), upload } }))

    await user.press(within(editor).getByRole('button', { name: 'Choose a photo' }))

    expect(await within(editor).findByText('photo.jpg could not be uploaded. Try again.')).toBeOnTheScreen()
  })

  it('says so when the camera may not be used', async () => {
    const { user, editor } = await editTask(dependencies({ pickFile: jest.fn().mockRejectedValue(new CameraRefusedError()) }))

    await user.press(within(editor).getByRole('button', { name: 'Take a photo' }))

    expect(await within(editor).findByText("TaskFest may not use the camera. Allow it in the phone's settings.")).toBeOnTheScreen()
  })

  it('does nothing when the user turns back from the picker', async () => {
    const deps = dependencies({ pickFile: jest.fn().mockResolvedValue(null) })
    const { user, editor } = await editTask(deps)

    await user.press(within(editor).getByRole('button', { name: 'Choose a photo' }))

    expect(deps.attachments!.upload).not.toHaveBeenCalled()
  })

  it('offers no more once the task holds as many files as it can', async () => {
    const full = { ...task, attachments: [attached(photo, 3), attached(scan, 4)] }
    const { editor } = await editTask(dependencies({ fetchTasks: jest.fn().mockResolvedValue([full]) }))

    expect(within(editor).getByText('This task holds the most attachments it can (2).')).toBeOnTheScreen()
    expect(within(editor).queryByRole('button', { name: 'Choose a file' })).toBeNull()
  })

  it("offers nothing to attach to a completed task, whose files may only be opened", async () => {
    const { editor } = await editTask(dependencies({ fetchTasks: jest.fn().mockResolvedValue([{ ...task, state: 'DONE' }]) }))

    expect(within(editor).queryByRole('button', { name: 'Choose a file' })).toBeNull()
  })
})

describe('attaching files while adding a task (#274)', () => {
  it('holds the files picked until the task exists, then attaches them', async () => {
    const created: BoardTask = { id: 2, description: 'Pay the bill', dueDate: '2026-10-19', importance: 'MEDIUM', state: 'TODO' }
    const pickFile = jest.fn().mockResolvedValueOnce(photo).mockResolvedValueOnce(scan)
    let id = 10
    const upload = jest.fn((_caller, _taskId, file: PickedFile) => Promise.resolve(attached(file, id++)))
    const deps = dependencies({
      pickFile,
      attachments: { link: jest.fn().mockResolvedValue('https://bucket.example.com/x'), remove: jest.fn(), upload },
      changes: { create: jest.fn().mockResolvedValue(created), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    })
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
    const user = userEvent.setup()
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = await screen.findByTestId('task-form')

    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')
    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))
    await user.press(within(form).getByRole('button', { name: 'Choose a file' }))
    expect(within(form).getByText('scan.pdf')).toBeOnTheScreen()
    expect(upload).not.toHaveBeenCalled()
    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(upload).toHaveBeenCalledWith(expect.anything(), 2, photo, expect.any(Function))
    expect(upload).toHaveBeenCalledWith(expect.anything(), 2, scan, expect.any(Function))
    const row = await screen.findByTestId('task-2')
    expect(await within(row).findByRole('button', { name: 'Open scan.pdf' })).toBeOnTheScreen()
  })

  it('lets a file picked go again before the task is added', async () => {
    const deps = dependencies()
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
    const user = userEvent.setup()
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))
    await user.press(await within(form).findByRole('button', { name: 'Remove photo.jpg' }))

    expect(within(form).queryByText('photo.jpg')).toBeNull()
  })

  it('refuses a file the backend would refuse the moment it is picked', async () => {
    const deps = dependencies({ pickFile: jest.fn().mockResolvedValue({ ...photo, name: 'huge.jpg', size: 20 * 1024 * 1024 }) })
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
    const user = userEvent.setup()
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = await screen.findByTestId('task-form')

    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))

    expect(await within(form).findByText('huge.jpg is larger than the limit.')).toBeOnTheScreen()
    expect(within(form).queryByRole('button', { name: 'Remove huge.jpg' })).toBeNull()
  })

  it('keeps the task, and says which file could not be attached', async () => {
    const created: BoardTask = { id: 2, description: 'Pay the bill', dueDate: '2026-10-19', importance: 'MEDIUM', state: 'TODO' }
    const deps = dependencies({
      attachments: { link: jest.fn(), remove: jest.fn(), upload: jest.fn().mockRejectedValue(new Error('offline')) },
      changes: { create: jest.fn().mockResolvedValue(created), update: jest.fn(), remove: jest.fn(), restore: jest.fn() },
    })
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
    const user = userEvent.setup()
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = await screen.findByTestId('task-form')
    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')
    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('photo.jpg could not be uploaded. Try again.')).toBeOnTheScreen()
    expect(screen.getByText('Pay the bill')).toBeOnTheScreen()
  })
})

describe('attaching, while other things happen (#274)', () => {
  it('waits for the upload before the task can be saved or deleted', async () => {
    const upload = jest.fn(() => new Promise<never>(() => undefined))
    const { user, editor } = await editTask(dependencies({ attachments: { link: jest.fn(), remove: jest.fn(), upload } }))

    await user.press(within(editor).getByRole('button', { name: 'Choose a photo' }))

    expect(await within(editor).findByText('Uploading photo.jpg')).toBeOnTheScreen()
    expect(within(editor).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(editor).getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('says on the board when a file could not be attached after its editor was closed', async () => {
    let fail: (error: Error) => void = () => undefined
    const upload = jest.fn(() => new Promise<never>((_resolve, reject) => (fail = reject)))
    const { user, editor } = await editTask(dependencies({ attachments: { link: jest.fn(), remove: jest.fn(), upload } }))
    await user.press(within(editor).getByRole('button', { name: 'Choose a photo' }))
    await within(editor).findByText('Uploading photo.jpg')

    await user.press(within(editor).getByRole('button', { name: 'Cancel' }))
    await act(async () => fail(new Error('offline')))

    expect(await screen.findByText('photo.jpg could not be uploaded. Try again.')).toBeOnTheScreen()
  })

  it("shows an upload in its own task's editor only", async () => {
    const other: BoardTask = { ...task, id: 2, description: 'Pay the bill' }
    const upload = jest.fn(() => new Promise<never>(() => undefined))
    const { user, editor } = await editTask(
      dependencies({ fetchTasks: jest.fn().mockResolvedValue([task, other]), attachments: { link: jest.fn(), remove: jest.fn(), upload } }),
    )
    await user.press(within(editor).getByRole('button', { name: 'Choose a photo' }))
    await within(editor).findByText('Uploading photo.jpg')
    await user.press(within(editor).getByRole('button', { name: 'Cancel' }))

    await user.press(screen.getByRole('button', { name: 'Edit "Pay the bill"' }))

    const second = await screen.findByTestId('task-form')
    expect(within(second).queryByText('Uploading photo.jpg')).toBeNull()
    expect(within(second).getByRole('button', { name: 'Choose a photo' })).toBeEnabled()
  })

  it("lets no file go while the task they are held for is being added", async () => {
    const deps = dependencies({ changes: { create: jest.fn(() => new Promise<never>(() => undefined)), update: jest.fn(), remove: jest.fn(), restore: jest.fn() } })
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
    const user = userEvent.setup()
    await user.press(await screen.findByRole('button', { name: 'Add a task' }))
    const form = await screen.findByTestId('task-form')
    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')
    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    expect(within(form).getByRole('button', { name: 'Remove photo.jpg' })).toBeDisabled()
  })
})

describe('coming back from a file opened in another app (#274)', () => {
  it('does not start the app over, as coming back from a sheet does not', async () => {
    let onChange: (state: string) => void = () => undefined
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      onChange = listener as (state: string) => void
      return { remove: jest.fn() } as never
    })
    let back: () => void = () => undefined
    const documents = { open: jest.fn(() => new Promise<void>((resolve) => (back = resolve))), forget: jest.fn() }
    const withScan = { ...task, attachments: [attached(scan, 5)] }
    const fetchTasks = jest.fn().mockResolvedValue([withScan])
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={dependencies({ fetchTasks, documents })} />)

    await userEvent.setup().press(await screen.findByRole('button', { name: 'Open scan.pdf' }))
    await waitFor(() => expect(documents.open).toHaveBeenCalled())
    await act(async () => onChange('active'))
    await act(async () => back())

    expect(fetchTasks).toHaveBeenCalledTimes(1)
  })
})
