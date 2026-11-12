/**
 * The large preview of a file (#586): a photo or a PDF over the board, with Download, which saves
 * the original under its own name, and Close. Against a stubbed `fetch`; whether storage answers
 * the browser is the end-to-end suite's business.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FilePreview from './components/FilePreview'

const PHOTO = { fileName: 'Quittung.jpg', contentType: 'image/jpeg', url: 'https://bucket.example.com/object-8' }
const PDF = { fileName: 'Rechnung.pdf', contentType: 'application/pdf', url: 'https://bucket.example.com/object-7' }

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a photo', () => {
  it('is shown large, in a dialog named after it', () => {
    render(<FilePreview file={PHOTO} onClose={() => {}} />)

    const dialog = screen.getByRole('dialog', { name: 'Quittung.jpg' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('img', { name: 'Quittung.jpg' })).toHaveAttribute('src', PHOTO.url)
  })

  it('closes with Close, with Escape, and with a click beside it, but not on it', () => {
    const onClose = vi.fn()
    render(<FilePreview file={PHOTO} onClose={onClose} />)

    fireEvent.click(screen.getByRole('img', { name: 'Quittung.jpg' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('file-preview-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('takes the focus, so the keyboard is in it at once', () => {
    render(<FilePreview file={PHOTO} onClose={() => {}} />)

    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})

describe('downloading', () => {
  it('saves the original file under its own name', async () => {
    const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
    const fetched = vi.fn().mockResolvedValue(new Response(blob))
    vi.stubGlobal('fetch', fetched)
    const created = vi.fn().mockReturnValue('blob:preview-1')
    const revoked = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }))
    const saved: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.href, download: this.download })
    })
    render(<FilePreview file={PHOTO} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(saved).toEqual([{ href: 'blob:preview-1', download: 'Quittung.jpg' }]))
    expect(fetched).toHaveBeenCalledWith(PHOTO.url)
    await waitFor(() => expect(revoked).toHaveBeenCalledWith('blob:preview-1'))
  })

  it('says so when the file could not be fetched, and stays open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    const onClose = vi.fn()
    render(<FilePreview file={PHOTO} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(await screen.findByText('Quittung.jpg could not be downloaded. Try again.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a PDF', () => {
  it('is shown in the browser\'s own viewer where the browser has one', () => {
    render(<FilePreview file={PDF} onClose={() => {}} inlinePdf />)

    expect(screen.getByTitle('Rechnung.pdf')).toHaveAttribute('src', PDF.url)
    expect(screen.queryByRole('link', { name: 'Open in a new tab' })).not.toBeInTheDocument()
  })

  it('is offered to open in a new tab where the browser cannot show it inline', () => {
    render(<FilePreview file={PDF} onClose={() => {}} inlinePdf={false} />)

    expect(screen.queryByTitle('Rechnung.pdf')).not.toBeInTheDocument()
    const open = screen.getByRole('link', { name: 'Open in a new tab' })
    expect(open).toHaveAttribute('href', PDF.url)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })
})
