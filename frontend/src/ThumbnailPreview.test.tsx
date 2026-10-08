/**
 * The row's preview of an image (#236): its thumbnail when it has one, the file itself when it has
 * none, and the file again when the thumbnail cannot be shown.
 *
 * Against a stubbed `fetch`, like Attachments.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { addDays, todayIso } from './dates'

function json(value: unknown, status = 200) {
  return Promise.resolve(new Response(value === null ? null : JSON.stringify(value), { status }))
}

function board(photo: Record<string, unknown>, thumbnailLinkStatus = 200) {
  globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/api/auth/me')) return json({ email: 'alice@example.com' })
    if (url.includes('/api/auth/providers')) return json({ enabled: true, providers: [] })
    if (url.endsWith('/thumbnail-link') && thumbnailLinkStatus !== 200) return json(null, thumbnailLinkStatus)
    if (url.endsWith('/thumbnail-link')) return json({ url: 'https://bucket.example.com/thumbnail', expiresAt: '2099-01-01T00:00:00Z' })
    if (url.endsWith('/link')) return json({ url: 'https://bucket.example.com/file', expiresAt: '2099-01-01T00:00:00Z' })
    if (url.endsWith('/api/tasks')) {
      return json([{ id: 1, description: 'Holiday', dueDate: addDays(todayIso(), 1), importance: 'LOW', state: 'TODO',
        attachments: [{ id: 8, fileName: 'beach.jpg', contentType: 'image/jpeg', sizeBytes: 9000000, ...photo }] }])
    }
    return json(null, 404)
  }) as unknown as typeof fetch
  render(<App />)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('previewing an image on its row', () => {
  it('shows its thumbnail rather than the whole photo', async () => {
    board({ thumbnail: true })

    expect(await screen.findByAltText('beach.jpg')).toHaveAttribute('src', 'https://bucket.example.com/thumbnail')
  })

  it('shows the file itself when it has no thumbnail', async () => {
    board({ thumbnail: false })

    expect(await screen.findByAltText('beach.jpg')).toHaveAttribute('src', 'https://bucket.example.com/file')
  })

  it('falls back to the file when the thumbnail cannot be shown', async () => {
    board({ thumbnail: true })
    const image = await screen.findByAltText('beach.jpg')

    fireEvent.error(image)

    await waitFor(() => expect(screen.getByAltText('beach.jpg')).toHaveAttribute('src', 'https://bucket.example.com/file'))
  })

  it('falls back to the file when no link to the thumbnail can be had', async () => {
    board({ thumbnail: true }, 404)

    expect(await screen.findByAltText('beach.jpg')).toHaveAttribute('src', 'https://bucket.example.com/file')
  })
})
