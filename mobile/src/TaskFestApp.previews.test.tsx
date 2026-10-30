import { fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native'
import type { BoardTask } from './api'
import type { PreviewStore } from './previews'
import type { Session } from './session'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { HOUR, dependencies as appDependencies, linkTo, memoryBoard, memorySessions, tokenWith } from './testing'
import { variantOf } from './variants'

/**
 * The previews kept on the phone (#397): a preview the board has shown is kept, and shown from
 * there the next time -- without asking for a link online, and without a connection on the kept
 * board -- until its attachment has left the board or the session ends.
 */

// Its own day, and Alice signed in on it, rather than the shared NOW and session.
const NOW = Date.UTC(2026, 9, 28, 9)
const idToken = tokenWith({ exp: (NOW + HOUR) / 1000, email: 'alice@example.com' })
const session: Session = { idToken, refreshToken: 'r', expiresAt: NOW + HOUR, lastUsedAt: NOW }

const photo = { id: 3, fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 2_000_000, thumbnail: true }
const sketch = { id: 4, fileName: 'sketch.png', contentType: 'image/png', sizeBytes: 30_000, thumbnail: false }
const scan = { id: 5, fileName: 'scan.pdf', contentType: 'application/pdf', sizeBytes: 90_000, thumbnail: false }

const withFiles: BoardTask = {
  id: 1,
  description: 'Water the plants',
  dueDate: '2026-10-28',
  importance: 'HIGH',
  state: 'TODO',
  attachments: [photo, sketch, scan],
}

/** Previews in memory, by their file's name (`3`, or `4-file` for a file itself): what each was downloaded from. */
function memoryPreviews(initial: Record<string, string> = {}): PreviewStore & { kept: Map<string, string> } {
  const kept = new Map(Object.entries(initial))
  const nameOf = (id: number, thumbnail: boolean) => (thumbnail ? String(id) : `${id}-file`)
  return {
    kept,
    find: jest.fn(async (id: number, thumbnail: boolean) => (kept.has(nameOf(id, thumbnail)) ? `file:///previews/${nameOf(id, thumbnail)}` : null)),
    keep: jest.fn(async (id: number, thumbnail: boolean, url: string) => {
      kept.set(nameOf(id, thumbnail), url)
      return `file:///previews/${nameOf(id, thumbnail)}`
    }),
    retain: jest.fn(async (ids: Iterable<number>) => {
      const wanted = new Set([...ids].map(String))
      ;[...kept.keys()].filter((name) => !wanted.has(name.split('-')[0])).forEach((name) => kept.delete(name))
    }),
    clear: jest.fn(async () => kept.clear()),
  }
}

/** One task with three files, the backend that links them, and a board kept in memory. */
function dependencies(overrides: Partial<Dependencies> = {}): Dependencies {
  return appDependencies({
    sessions: memorySessions(session),
    fetchTasks: jest.fn().mockResolvedValue([withFiles]),
    attachments: { link: jest.fn(linkTo), remove: jest.fn().mockResolvedValue(undefined) },
    documents: { open: jest.fn().mockResolvedValue(undefined), forget: jest.fn().mockResolvedValue(undefined) },
    keptBoard: memoryBoard(null),
    reminders: { permission: jest.fn().mockResolvedValue('denied'), ask: jest.fn(), replace: jest.fn().mockResolvedValue(undefined), answered: jest.fn().mockResolvedValue(true), decline: jest.fn() },
    now: () => NOW,
    ...overrides,
  })
}

const dev = variantOf('dev', {})

function show(deps: Dependencies) {
  return render(<TaskFestApp variant={dev} language="en" dependencies={deps} />)
}

describe('the previews kept on the phone (#397)', () => {
  it('shows each preview from its link at once, and keeps it -- the thumbnail, or the file of an image without one', async () => {
    const previews = memoryPreviews()
    await show(dependencies({ previews }))

    expect(await screen.findByTestId('preview-3')).toHaveProp('source', { uri: 'https://bucket.example.com/1/3/thumbnail' })
    expect(await screen.findByTestId('preview-4')).toHaveProp('source', { uri: 'https://bucket.example.com/1/4/file' })
    await waitFor(() =>
      expect(previews.kept).toEqual(
        new Map([
          ['3', 'https://bucket.example.com/1/3/thumbnail'],
          ['4-file', 'https://bucket.example.com/1/4/file'],
        ]),
      ),
    )
  })

  it('shows a kept preview without asking for a link', async () => {
    const deps = dependencies({ previews: memoryPreviews({ '3': 'kept', '4-file': 'kept' }) })
    await show(deps)

    expect(await screen.findByTestId('preview-3')).toHaveProp('source', { uri: 'file:///previews/3' })
    expect(await screen.findByTestId('preview-4')).toHaveProp('source', { uri: 'file:///previews/4-file' })
    expect(deps.attachments!.link).not.toHaveBeenCalled()
  })

  it('shows the kept board with its kept previews without a connection', async () => {
    const offline = () => Promise.reject(new TypeError('Network request failed'))
    await show(
      dependencies({
        keptBoard: memoryBoard({ account: 'alice@example.com', savedAt: NOW - HOUR, tasks: [withFiles] }),
        fetchTasks: jest.fn(offline),
        attachments: { link: jest.fn(offline), remove: jest.fn() },
        previews: memoryPreviews({ '3': 'kept' }),
      }),
    )

    expect(await screen.findByTestId('preview-3')).toHaveProp('source', { uri: 'file:///previews/3' })
    // Never seen online: the box it was before.
    expect(screen.queryByTestId('preview-4')).toBeNull()
  })

  it('falls back to the file when a kept thumbnail cannot be shown', async () => {
    await show(dependencies({ previews: memoryPreviews({ '3': 'kept, but broken' }) }))
    const preview = await screen.findByTestId('preview-3')

    fireEvent(preview, 'error')

    await waitFor(() => expect(screen.getByTestId('preview-3')).toHaveProp('source', { uri: 'https://bucket.example.com/1/3/file' }))
  })

  it('shows a preview from its link when it cannot be kept', async () => {
    const previews = memoryPreviews()
    previews.keep = jest.fn().mockRejectedValue(new Error('disk full'))
    await show(dependencies({ previews }))

    expect(await screen.findByTestId('preview-3')).toHaveProp('source', { uri: 'https://bucket.example.com/1/3/thumbnail' })
  })

  it('keeps only the previews of the attachments on the board it keeps', async () => {
    const previews = memoryPreviews({ '9': 'a file since removed' })
    await show(dependencies({ previews }))

    await waitFor(() => expect(previews.retain).toHaveBeenCalledWith([3, 4, 5]))
    expect(previews.kept.has('9')).toBe(false)
  })

  it('does not keep a preview whose link arrives after signing out', async () => {
    const previews = memoryPreviews()
    let answer: (url: string) => void = () => undefined
    const link = jest.fn(() => new Promise<string>((resolve) => (answer = resolve)))
    await show(dependencies({ previews, attachments: { link, remove: jest.fn() } }))
    await waitFor(() => expect(link).toHaveBeenCalled())
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))
    await screen.findByRole('button', { name: 'Sign in with Keycloak' })
    answer('https://bucket.example.com/1/3/thumbnail')

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(previews.keep).not.toHaveBeenCalled()
  })

  it('forgets the kept previews on signing out', async () => {
    const previews = memoryPreviews()
    await show(dependencies({ previews }))
    await screen.findByTestId('preview-3')
    const user = userEvent.setup()

    await user.press(screen.getByRole('button', { name: 'Account' }))
    await user.press(screen.getByRole('button', { name: 'Sign out' }))

    await screen.findByRole('button', { name: 'Sign in with Keycloak' })
    expect(previews.clear).toHaveBeenCalled()
    expect(previews.kept.size).toBe(0)
  })
})
