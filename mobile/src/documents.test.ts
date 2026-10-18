import { documentOpenerFor, safeFileName } from './documents'

/** Opening a PDF in the phone's own viewer (#274): iOS shows it from its link, Android from a copy. */
function platform() {
  return {
    openBrowser: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue({ contentUri: 'content://de.hilling.taskfest/cache/documents/scan.pdf' }),
    view: jest.fn().mockResolvedValue(undefined),
  }
}

describe("opening a PDF in the phone's viewer (#274)", () => {
  it('shows it from its link on iOS, where the in-app browser shows PDFs itself', async () => {
    const parts = platform()

    await documentOpenerFor('ios', parts)('https://bucket.example.com/scan', 'scan.pdf')

    expect(parts.openBrowser).toHaveBeenCalledWith('https://bucket.example.com/scan')
    expect(parts.download).not.toHaveBeenCalled()
  })

  it("downloads it on Android and hands it to whatever views PDFs there, allowed to read it", async () => {
    const parts = platform()

    await documentOpenerFor('android', parts)('https://bucket.example.com/scan', 'scan.pdf')

    expect(parts.download).toHaveBeenCalledWith('https://bucket.example.com/scan', 'scan.pdf')
    expect(parts.view).toHaveBeenCalledWith('content://de.hilling.taskfest/cache/documents/scan.pdf', 'application/pdf')
    expect(parts.openBrowser).not.toHaveBeenCalled()
  })

  it('names the copy after the file, without anything that could leave its folder', () => {
    expect(safeFileName('scan.pdf')).toBe('scan.pdf')
    expect(safeFileName('../../etc/passwd.pdf')).toBe('.._.._etc_passwd.pdf')
    expect(safeFileName('')).toBe('document.pdf')
    expect(safeFileName('report')).toBe('report.pdf')
  })
})
