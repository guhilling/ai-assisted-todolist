import { documentsFor, safeFileName } from './documents'

/** Opening a file in the phone's own viewer (#274): iOS shows it from its link, Android from a copy. */
function platform() {
  return {
    openBrowser: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue({ contentUri: 'content://de.hilling.taskfest/cache/documents/scan.pdf' }),
    view: jest.fn().mockResolvedValue(undefined),
    forget: jest.fn().mockResolvedValue(undefined),
  }
}

describe("opening a file in the phone's viewer (#274)", () => {
  it('shows it from its link on iOS, where the in-app browser shows PDFs itself', async () => {
    const parts = platform()

    await documentsFor('ios', parts).open('https://bucket.example.com/scan', 'scan.pdf', 'application/pdf')

    expect(parts.openBrowser).toHaveBeenCalledWith('https://bucket.example.com/scan')
    expect(parts.download).not.toHaveBeenCalled()
  })

  it('downloads it on Android and hands it, by its own type, to whatever views that there', async () => {
    const parts = platform()

    await documentsFor('android', parts).open('https://bucket.example.com/scan', 'scan.pdf', 'application/pdf')

    expect(parts.download).toHaveBeenCalledWith('https://bucket.example.com/scan', 'scan.pdf')
    expect(parts.view).toHaveBeenCalledWith('content://de.hilling.taskfest/cache/documents/scan.pdf', 'application/pdf')
    expect(parts.openBrowser).not.toHaveBeenCalled()
  })

  it('forgets the copies it made', async () => {
    const parts = platform()

    await documentsFor('android', parts).forget()

    expect(parts.forget).toHaveBeenCalled()
  })

  it('names the copy after the file, without anything that could leave its folder', () => {
    expect(safeFileName('scan.pdf')).toBe('scan.pdf')
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd')
    expect(safeFileName('')).toBe('document')
  })
})

describe("the cached copy's name (#274)", () => {
  it('is never the folder itself, or the one above it', () => {
    expect(safeFileName('..')).toBe('document')
    expect(safeFileName('.')).toBe('document')
    expect(safeFileName('...pdf')).toBe('...pdf')
  })
})
