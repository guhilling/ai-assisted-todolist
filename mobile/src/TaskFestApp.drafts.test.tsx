import { render, screen, userEvent, waitFor, within } from '@testing-library/react-native'
import { RequestFailedError, type BoardTask } from './api'
import type { SharedDraft } from './incoming'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, memorySessions, tokenWith } from './testing'
import type { PickedFile } from './upload'
import { variantOf } from './variants'

/**
 * Files upload while the add form is open (#381): a share's files, and files picked in the form,
 * go up at once to a draft task the backend keeps out of sight, and Add makes the draft the task.
 * Cancel discards it with its files. A backend from before drafts has the files wait for Add, as
 * before.
 */

// Its own day, and Alice signed in on it, rather than the shared NOW and session.
const NOW = Date.UTC(2026, 9, 18, 9)
const idToken = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const task: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-18', importance: 'HIGH', state: 'TODO', attachments: [] }
const photo: PickedFile = { uri: 'file:///cache/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', size: 2_000_000 }
const scan: PickedFile = { uri: 'file:///cache/scan.pdf', name: 'scan.pdf', type: 'application/pdf', size: 90_000 }
const DRAFT = 77

function attached(file: PickedFile, id: number) {
  return { id, fileName: file.name, contentType: file.type, sizeBytes: file.size, thumbnail: false }
}

function sharing(share: SharedDraft) {
  return { take: jest.fn().mockResolvedValueOnce(share).mockResolvedValue(null), forget: jest.fn().mockResolvedValue(undefined) }
}

/** One task without files, a photo to pick, and a backend with drafts. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  let id = 10
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue([task]),
    changes: {
      create: jest.fn((_caller, input) => Promise.resolve({ id: 2, attachments: [], ...input })),
      update: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(),
      drafts: {
        start: jest.fn().mockResolvedValue(DRAFT),
        add: jest.fn((_caller, draftId, input) =>
          Promise.resolve({ id: draftId, ...input, attachments: [attached(photo, 10)] }),
        ),
        discard: jest.fn().mockResolvedValue(undefined),
      },
    },
    attachments: {
      link: jest.fn().mockResolvedValue('https://bucket.example.com/x'),
      remove: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn((_caller, _taskId, file: PickedFile) => Promise.resolve(attached(file, id++))),
    },
    pickFile: jest.fn().mockResolvedValue(photo),
    documents: { open: jest.fn(), forget: jest.fn().mockResolvedValue(undefined) },
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    now: () => NOW,
    ...overrides,
  })
}

async function openAdd(deps: Dependencies) {
  await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)
  const user = userEvent.setup()
  await user.press(await screen.findByRole('button', { name: 'Add a task' }))
  return { user, form: await screen.findByTestId('task-form') }
}

describe('files upload while the add form is open (#381)', () => {
  it('uploads a file picked in the form at once, to a draft, and Add makes the draft the task', async () => {
    const deps = dependencies()
    const { user, form } = await openAdd(deps)

    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))

    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.objectContaining({ idToken }), DRAFT, photo, expect.any(Function)))
    expect(deps.changes.drafts!.start).toHaveBeenCalledTimes(1)
    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')
    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(deps.changes.drafts!.add).toHaveBeenCalledWith(expect.anything(), DRAFT, expect.objectContaining({ description: 'Pay the bill', state: 'TODO' })),
    )
    expect(deps.changes.create).not.toHaveBeenCalled()
    expect(deps.attachments!.upload).toHaveBeenCalledTimes(1)
    const row = await screen.findByTestId(`task-${DRAFT}`)
    expect(within(row).getByRole('button', { name: 'Open photo.jpg' })).toBeOnTheScreen()
    expect(deps.changes.drafts!.discard).not.toHaveBeenCalled()
  })

  it("uploads a share's files as soon as its form opens", async () => {
    const deps = dependencies({ incoming: sharing({ description: 'Rechnung', files: [scan, photo], refused: [] }) })
    await render(<TaskFestApp variant={variantOf('dev', {})} language="en" dependencies={deps} />)

    await screen.findByTestId('task-form')

    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalledTimes(2))
    expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), DRAFT, scan, expect.any(Function))
    expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), DRAFT, photo, expect.any(Function))
    expect(deps.changes.drafts!.start).toHaveBeenCalledTimes(1)
  })

  it('starts no draft for a task added without files', async () => {
    const deps = dependencies()
    const { user, form } = await openAdd(deps)

    await user.type(within(form).getByLabelText('What needs doing'), 'Call the plumber')
    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(deps.changes.create).toHaveBeenCalled())
    expect(deps.changes.drafts!.start).not.toHaveBeenCalled()
  })

  it('discards the draft, with its files, when the form is cancelled', async () => {
    const deps = dependencies()
    const { user, form } = await openAdd(deps)
    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalled())

    await user.press(within(form).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(deps.changes.drafts!.discard).toHaveBeenCalledWith(expect.anything(), DRAFT))
  })

  it('takes a file let go again off the draft', async () => {
    const deps = dependencies()
    const { user, form } = await openAdd(deps)
    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalled())

    await user.press(await within(form).findByRole('button', { name: 'Remove photo.jpg' }))

    expect(within(form).queryByText('photo.jpg')).toBeNull()
    await waitFor(() => expect(deps.attachments!.remove).toHaveBeenCalledWith(expect.anything(), DRAFT, 10))
  })

  it('says which file could not be uploaded, and leaves it out', async () => {
    const deps = dependencies()
    deps.attachments!.upload = jest.fn().mockRejectedValue(new Error('offline'))
    const { user, form } = await openAdd(deps)

    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))

    expect(await within(form).findByText('photo.jpg could not be uploaded. Try again.')).toBeOnTheScreen()
    expect(within(form).queryByRole('button', { name: 'Remove photo.jpg' })).toBeNull()
  })

  it('waits with Add while the draft is being started', async () => {
    const deps = dependencies()
    deps.changes.drafts!.start = jest.fn(() => new Promise<number>(() => undefined))
    const { user, form } = await openAdd(deps)
    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')

    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))

    await waitFor(() => expect(within(form).getByRole('button', { name: 'Add' })).toBeDisabled())
  })

  it('adds the task as before drafts when its draft was swept while the form stood open', async () => {
    const deps = dependencies()
    deps.changes.drafts!.add = jest.fn().mockRejectedValue(new RequestFailedError(404))
    const { user, form } = await openAdd(deps)
    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalledTimes(1))
    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')

    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(deps.changes.create).toHaveBeenCalled())
    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenLastCalledWith(expect.anything(), 2, photo, expect.any(Function)))
    expect(await screen.findByTestId('task-2')).toBeOnTheScreen()
  })

  it('has the files wait for Add, as before, where the backend has no drafts yet', async () => {
    const deps = dependencies()
    // /api/tasks/drafts is /api/tasks/{id} to a backend from before drafts, which takes no POST.
    deps.changes.drafts!.start = jest.fn().mockRejectedValue(new RequestFailedError(405))
    const { user, form } = await openAdd(deps)

    await user.press(within(form).getByRole('button', { name: 'Choose a photo' }))
    await waitFor(() => expect(deps.changes.drafts!.start).toHaveBeenCalled())
    expect(deps.attachments!.upload).not.toHaveBeenCalled()
    await user.type(within(form).getByLabelText('What needs doing'), 'Pay the bill')
    await user.press(within(form).getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(deps.attachments!.upload).toHaveBeenCalledWith(expect.anything(), 2, photo, expect.any(Function)))
    expect(deps.changes.create).toHaveBeenCalled()
  })
})
