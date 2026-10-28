import { fireEvent, render, screen, userEvent, waitFor } from '@testing-library/react-native'
import type { BoardTask } from './api'
import type { KeptBoard } from './keptBoard'
import type { PreviewStore } from './previews'
import type { Session } from './session'
import type { SessionStore } from './staySignedIn'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { variantOf } from './variants'

/**
 * The previews kept on the phone (#397): a preview the board has shown is kept, and shown from
 * there the next time -- without asking for a link online, and without a connection on the kept
 * board -- until its attachment has left the board or the session ends.
 */

const NOW = Date.UTC(2026, 9, 28, 9)
const HOUR = 3600 * 1000

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

function memoryBoard(initial: KeptBoard | null) {
  let stored = initial
  return {
    load: async () => stored,
    save: async (board: KeptBoard) => void (stored = board),
    clear: async () => void (stored = null),
  }
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
    keptBoard: memoryBoard(null),
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
