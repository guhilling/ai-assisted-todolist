/**
 * The row's preview of an image (#236): its thumbnail when it has one, the file itself when it has
 * none, and the file again when the thumbnail cannot be shown.
 *
 * Against a stubbed `fetch`, like Attachments.test.tsx.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { stubApi } from './testing/api'
import { ALICE, isoIn } from './testing/board'

function board(photo: Record<string, unknown>, thumbnailLinkStatus = 200) {
  globalThis.fetch = stubApi({
    me: ALICE,
    tasks: [{ id: 1, description: 'Holiday', dueDate: isoIn(1), importance: 'LOW', state: 'TODO',
      attachments: [{ id: 8, fileName: 'beach.jpg', contentType: 'image/jpeg', sizeBytes: 9000000, ...photo }] }],
    thumbnailLink: { status: thumbnailLinkStatus },
    link: { url: 'https://bucket.example.com/file' },
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
