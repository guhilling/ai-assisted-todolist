import { documentsFor, safeFileName } from './documents'

/** Opening a file in the phone's own viewer (#274): iOS shows it from its link, Android from a copy. */
function platform() {
  return {
    openBrowser: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue({
      contentUri: 'content://de.hilling.taskfest/cache/documents/scan.pdf',
      uri: 'file:///cache/documents/scan.pdf',
    }),
    view: jest.fn().mockResolvedValue(undefined),
    share: jest.fn().mockResolvedValue(undefined),
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

describe('a copy downloaded after its session ended (#274)', () => {
  it('is neither viewed nor kept, when the copies were forgotten while it downloaded', async () => {
    const parts = { ...platform(), discard: jest.fn().mockResolvedValue(undefined) }
    let arrive: (copy: { contentUri: string }) => void = () => undefined
    parts.download.mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    const documents = documentsFor('android', parts)

    const opened = documents.open('https://bucket.example.com/scan', 'scan.pdf', 'application/pdf')
    await documents.forget()
    arrive({ contentUri: 'content://de.hilling.taskfest/cache/documents/scan.pdf' })
    await opened

    expect(parts.view).not.toHaveBeenCalled()
    expect(parts.discard).toHaveBeenCalledWith('scan.pdf')
  })
})

describe('saving a file (#586)', () => {
  it.each(['ios', 'android'])("downloads a copy on %s and hands it, by its own type, to the share sheet", async (os) => {
    const parts = platform()

    await documentsFor(os, parts).save('https://bucket.example.com/photo', 'photo.jpg', 'image/jpeg')

    expect(parts.download).toHaveBeenCalledWith('https://bucket.example.com/photo', 'photo.jpg')
    expect(parts.share).toHaveBeenCalledWith('file:///cache/documents/scan.pdf', 'image/jpeg', 'photo.jpg')
  })

  it('neither shares nor keeps a copy that arrived after its session ended', async () => {
    const parts = { ...platform(), discard: jest.fn().mockResolvedValue(undefined) }
    let arrive: (copy: { contentUri: string; uri: string }) => void = () => undefined
    parts.download.mockReturnValue(new Promise((resolve) => (arrive = resolve)))
    const documents = documentsFor('ios', parts)

    const saved = documents.save('https://bucket.example.com/photo', 'photo.jpg', 'image/jpeg')
    await documents.forget()
    arrive({ contentUri: 'content://x/photo.jpg', uri: 'file:///cache/documents/photo.jpg' })
    await saved

    expect(parts.share).not.toHaveBeenCalled()
    expect(parts.discard).toHaveBeenCalledWith('photo.jpg')
  })
})
