/**
 * The large preview of a file (#586): a photo or a PDF over the board, with Download, which saves
 * the original under its own name, and Close. Against a stubbed `fetch`; whether storage answers
 * the browser is the end-to-end suite's business.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FilePreview from './components/FilePreview'

const PHOTO = { fileName: 'Quittung.jpg', contentType: 'image/jpeg', url: 'https://bucket.example.com/object-8' }
const PDF = { fileName: 'Rechnung.pdf', contentType: 'application/pdf', url: 'https://bucket.example.com/object-7' }

/** A fresh link to download from, as the board asks the backend for one. */
const fresh = () => Promise.resolve('https://bucket.example.com/object-8?fresh')

/** Saves what a click on a link with `download` would, instead of navigating jsdom. */
function catchSaves() {
  const saved: { href: string; download: string }[] = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ href: this.href, download: this.download })
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview-1', revokeObjectURL: vi.fn() }))
  return saved
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a photo', () => {
  it('is shown large, in a dialog named after it', () => {
    render(<FilePreview file={PHOTO} link={fresh} onClose={() => {}} />)

    expect(screen.getByRole('dialog', { name: 'Quittung.jpg' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Quittung.jpg' })).toHaveAttribute('src', PHOTO.url)
  })

  it('closes with Close, with Escape, and with a click beside it, but not on it', () => {
    const onClose = vi.fn()
    render(<FilePreview file={PHOTO} link={fresh} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Quittung.jpg' })

    fireEvent.click(screen.getByRole('img', { name: 'Quittung.jpg' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    // Escape, as a modal dialog reports it: a cancel, which would otherwise close it unbidden.
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancel)
    expect(cancel.defaultPrevented).toBe(true)
    // The backdrop is the dialog itself, around its content.
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('takes the focus, and gives it back to what had it when it goes', () => {
    render(<button type="button">Open Quittung.jpg</button>)
    const opener = screen.getByRole('button', { name: 'Open Quittung.jpg' })
    opener.focus()

    const { unmount } = render(<FilePreview file={PHOTO} link={fresh} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()

    unmount()
    expect(opener).toHaveFocus()
  })
})

describe('downloading', () => {
  it('saves the original under its own name, from a fresh link and not from the cache', async () => {
    const fetched = vi.fn().mockResolvedValue(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })))
    vi.stubGlobal('fetch', fetched)
    const saved = catchSaves()
    render(<FilePreview file={PHOTO} link={fresh} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() => expect(saved).toEqual([{ href: 'blob:preview-1', download: 'Quittung.jpg' }]))
    // A link that has expired while the preview was open, or an answer the browser cached for the
    // image without CORS headers, must not stand in the way.
    expect(fetched).toHaveBeenCalledWith('https://bucket.example.com/object-8?fresh', { cache: 'no-store' })
  })

  it('is not started twice while it runs', async () => {
    let answer: (response: Response) => void = () => {}
    const fetched = vi.fn().mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)))
    vi.stubGlobal('fetch', fetched)
    catchSaves()
    render(<FilePreview file={PHOTO} link={fresh} onClose={() => {}} />)
    const download = screen.getByRole('button', { name: 'Download' })

    fireEvent.click(download)
    await waitFor(() => expect(download).toBeDisabled())
    fireEvent.click(download)

    await act(async () => answer(new Response(new Blob(['jpeg']))))
    await waitFor(() => expect(download).toBeEnabled())
    expect(fetched).toHaveBeenCalledTimes(1)
  })

  it('says so when the file could not be fetched, and stays open', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })))
    const onClose = vi.fn()
    render(<FilePreview file={PHOTO} link={fresh} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(await screen.findByText('Quittung.jpg could not be downloaded. Try again.')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a PDF', () => {
  it("is shown in the browser's own viewer where the browser has one, and offered in a tab too", () => {
    render(<FilePreview file={PDF} link={fresh} onClose={() => {}} inlinePdf />)

    expect(screen.getByTitle('Rechnung.pdf')).toHaveAttribute('src', PDF.url)
    // Escape cannot leave the viewer once it has the focus, and a long document reads better in a
    // tab of its own: the tab is always offered.
    expect(screen.getByRole('link', { name: 'Open in a new tab' })).toHaveAttribute('href', PDF.url)
  })

  it('is offered in a new tab only where the browser cannot show it inline', () => {
    render(<FilePreview file={PDF} link={fresh} onClose={() => {}} inlinePdf={false} />)

    expect(screen.queryByTitle('Rechnung.pdf')).not.toBeInTheDocument()
    const open = screen.getByRole('link', { name: 'Open in a new tab' })
    expect(open).toHaveAttribute('href', PDF.url)
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })
})
