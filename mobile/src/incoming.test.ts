import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESCRIPTION_MAX_LENGTH, draftOf, LINK_MAX_LENGTH, sharesFrom, type IncomingParts, type ShareInbox, type SharedItem } from './incoming'

/** Reading what another app shared (#355), with a phone whose files are made up here. */
function phone(files: Record<string, { name: string | null; type: string | null; size?: number | null }> = {}): IncomingParts {
  return {
    describe: jest.fn((uri: string) => (files[uri] ? { size: null, ...files[uri] } : { name: null, type: null, size: null })),
    copy: jest.fn(async (_uri: string, name: string) => ({ uri: `file:///cache/shared/${name}`, size: 4_000 })),
    toJpeg: jest.fn().mockResolvedValue({ uri: 'file:///cache/converted.jpg', size: 900_000 }),
    discard: jest.fn(),
  }
}

const text = (value: string): SharedItem => ({ shareType: 'text', value, mimeType: 'text/plain' })
const link = (value: string): SharedItem => ({ shareType: 'url', value, mimeType: 'text/html' })
const file = (value: string, mimeType: string, shareType: SharedItem['shareType'] = 'file'): SharedItem => ({
  shareType,
  value,
  mimeType,
})

describe('a share becomes a draft task (#355)', () => {
  it('is nothing when nothing was shared', async () => {
    await expect(draftOf([], phone())).resolves.toBeNull()
  })

  it('takes shared text as the description', async () => {
    await expect(draftOf([text('  Read the article  ')], phone())).resolves.toEqual({
      description: 'Read the article',
      files: [],
      refused: [],
    })
  })

  it('takes the text as the description and the link as a link', async () => {
    const shared = [text('Read the article'), link('https://example.com/a')]

    await expect(draftOf(shared, phone())).resolves.toMatchObject({
      description: 'Read the article',
      links: [{ url: 'https://example.com/a', title: 'Read the article' }],
    })
  })

  it('takes a link shared alone as a link with no title, and leaves the description empty (#414)', async () => {
    await expect(draftOf([link('https://example.com/a')], phone())).resolves.toEqual({
      description: '',
      files: [],
      links: [{ url: 'https://example.com/a', title: null }],
      refused: [],
    })
  })

  it('keeps a "link" the backend would not take as text: no web address, or too long (#414)', async () => {
    // Android takes "notes.md" for an address, iOS any scheme; the backend only http and https.
    for (const value of ['notes.md', 'mailto:alice@example.com', `https://example.com/${'a'.repeat(2048)}`]) {
      const draft = await draftOf([link(value)], phone())

      expect(draft?.description).toBe(value.slice(0, DESCRIPTION_MAX_LENGTH))
      expect(draft?.links ?? []).toEqual([])
    }
  })

  it('titles a link by the text only when it is the one link: of several, each goes by its address (#414)', async () => {
    const shared = [text('Two pages'), link('https://example.com/a'), link('https://example.com/b')]

    await expect(draftOf(shared, phone())).resolves.toMatchObject({
      description: 'Two pages',
      links: [
        { url: 'https://example.com/a', title: null },
        { url: 'https://example.com/b', title: null },
      ],
    })
  })

  it('counts a link against what a task holds, after the files, and says which was left out (#414)', async () => {
    const parts = phone({
      'content://media/1': { name: 'one.png', type: 'image/png' },
      'content://media/2': { name: 'two.png', type: 'image/png' },
    })
    const shared = [file('content://media/1', 'image/png', 'image'), file('content://media/2', 'image/png', 'image'), link('https://example.com/a')]

    const draft = await draftOf(shared, parts)

    expect(draft?.links ?? []).toEqual([])
    expect(draft?.refused).toEqual([{ name: 'https://example.com/a', refusal: 'TASK_FULL' }])
  })

  it('cuts a long text to what the backend takes', async () => {
    const draft = await draftOf([text('x'.repeat(400))], phone())

    expect(draft?.description).toHaveLength(DESCRIPTION_MAX_LENGTH)
  })

  it('does not cut a character in half at the limit', async () => {
    const draft = await draftOf([text('x'.repeat(DESCRIPTION_MAX_LENGTH - 1) + '😀 and more')], phone())

    expect(draft?.description).toBe('x'.repeat(DESCRIPTION_MAX_LENGTH - 1))
  })

  it('has the backend’s limit', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '../../doc/api/schema/TaskCreateRequest.schema.json'), 'utf8'))

    expect(DESCRIPTION_MAX_LENGTH).toBe(schema.properties.description.maxLength)
  })

  it('has the backend’s limit for a link’s address (#414)', () => {
    const schema = JSON.parse(readFileSync(join(__dirname, '../../doc/api/schema/LinkRequest.schema.json'), 'utf8'))

    expect(LINK_MAX_LENGTH).toBe(schema.properties.url.maxLength)
  })

  it('copies a shared file into the app, as the sending app names it', async () => {
    const parts = phone({ 'content://docs/7': { name: 'Rechnung.pdf', type: 'application/pdf' } })

    await expect(draftOf([file('content://docs/7', 'application/pdf')], parts)).resolves.toEqual({
      description: '',
      files: [{ uri: 'file:///cache/shared/Rechnung.pdf', name: 'Rechnung.pdf', type: 'application/pdf', size: 4_000 }],
      refused: [],
    })
    expect(parts.copy).toHaveBeenCalledWith('content://docs/7', 'Rechnung.pdf')
  })

  it('names a file the sending app gave no name by its type', async () => {
    const draft = await draftOf([file('content://docs/8', 'application/pdf')], phone())

    expect(draft?.files.map((each) => each.name)).toEqual(['shared.pdf'])
  })

  it('names a file by its type when its name says nothing of it, such as a document’s number', async () => {
    const parts = phone({
      'content://media/1000000018': { name: '1000000018', type: 'image/png' },
      'content://docs/document/image%3A7': { name: 'image%3A7', type: 'image/png' },
    })
    const shared = [file('content://media/1000000018', 'image/png', 'image'), file('content://docs/document/image%3A7', 'image/png', 'image')]

    const draft = await draftOf(shared, parts)

    expect(draft?.files.map((each) => each.name)).toEqual(['shared.png', 'shared.png'])
  })

  it('reads a name written as a link would write it', async () => {
    const parts = phone({ 'file:///group/Rechnung%20M%C3%A4rz.pdf': { name: 'Rechnung%20M%C3%A4rz.pdf', type: null } })

    const draft = await draftOf([file('file:///group/Rechnung%20M%C3%A4rz.pdf', 'application/pdf')], parts)

    expect(draft?.files.map((each) => each.name)).toEqual(['Rechnung März.pdf'])
  })

  it('keeps a name that is not a link’s as it is', async () => {
    const parts = phone({ 'content://docs/5': { name: '100% done.pdf', type: null } })

    const draft = await draftOf([file('content://docs/5', 'application/pdf')], parts)

    expect(draft?.files.map((each) => each.name)).toEqual(['100% done.pdf'])
  })

  it('keeps only the last part of a name that is a path, so nothing lands outside the app’s folder', async () => {
    const parts = phone({ 'content://evil/1': { name: '../../shared_prefs/x.png', type: 'image/png' } })

    const draft = await draftOf([file('content://evil/1', 'image/png', 'image')], parts)

    expect(draft?.files.map((each) => each.name)).toEqual(['x.png'])
    expect(parts.copy).toHaveBeenCalledWith('content://evil/1', 'x.png')
  })

  it('goes by the name when the share says only “an image”', async () => {
    const parts = phone({ 'content://media/9': { name: 'scan.webp', type: null } })

    const draft = await draftOf([file('content://media/9', 'image/*', 'image')], parts)

    expect(draft?.files.map((each) => each.type)).toEqual(['image/webp'])
  })

  it("turns an iPhone's HEIC photo into a JPEG, which the backend takes", async () => {
    const parts = phone({ 'file:///group/IMG_2.HEIC': { name: 'IMG_2.HEIC', type: 'image/heic' } })

    const draft = await draftOf([file('file:///group/IMG_2.HEIC', 'image/heic', 'image')], parts)

    expect(draft?.files).toEqual([{ uri: 'file:///cache/converted.jpg', name: 'IMG_2.jpg', type: 'image/jpeg', size: 900_000 }])
    expect(parts.toJpeg).toHaveBeenCalledWith('file:///cache/shared/IMG_2.HEIC')
    expect(parts.discard).toHaveBeenCalledWith('file:///cache/shared/IMG_2.HEIC')
  })

  it('refuses a file the backend would refuse, by the website’s rule, without copying it', async () => {
    const parts = phone({ 'content://docs/3': { name: 'notes.docx', type: null } })

    const draft = await draftOf(
      [file('content://docs/3', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')],
      parts,
    )

    expect(draft).toEqual({ description: '', files: [], refused: [{ name: 'notes.docx', refusal: 'UNSUPPORTED_TYPE' }] })
    expect(parts.copy).not.toHaveBeenCalled()
  })

  it('refuses a file too large once copied, and lets the copy go', async () => {
    const parts = phone({ 'content://docs/4': { name: 'huge.pdf', type: 'application/pdf' } })
    jest.mocked(parts.copy).mockResolvedValue({ uri: 'file:///cache/shared/huge.pdf', size: 50 * 1024 * 1024 })

    const draft = await draftOf([file('content://docs/4', 'application/pdf')], parts)

    expect(draft).toEqual({ description: '', files: [], refused: [{ name: 'huge.pdf', refusal: 'TOO_LARGE' }] })
    expect(parts.discard).toHaveBeenCalledWith('file:///cache/shared/huge.pdf')
  })

  it('refuses a file the sending app says is too large without copying it', async () => {
    const parts = phone({ 'content://docs/6': { name: 'film.pdf', type: 'application/pdf', size: 300 * 1024 * 1024 } })

    const draft = await draftOf([file('content://docs/6', 'application/pdf')], parts)

    expect(draft?.refused).toEqual([{ name: 'film.pdf', refusal: 'TOO_LARGE' }])
    expect(parts.copy).not.toHaveBeenCalled()
  })

  it('keeps the rest of a share when one file cannot be copied, and says which', async () => {
    const parts = phone({
      'content://docs/1': { name: 'gone.pdf', type: 'application/pdf' },
      'content://docs/2': { name: 'kept.pdf', type: 'application/pdf' },
    })
    jest.mocked(parts.copy).mockRejectedValueOnce(new Error('Permission denial'))

    const draft = await draftOf([text('Invoices'), file('content://docs/1', 'application/pdf'), file('content://docs/2', 'application/pdf')], parts)

    expect(draft?.description).toBe('Invoices')
    expect(draft?.files.map((each) => each.name)).toEqual(['kept.pdf'])
    expect(draft?.refused).toEqual([{ name: 'gone.pdf', refusal: 'UNREADABLE' }])
  })

  it('says so of a file the phone cannot even describe, and keeps the rest of the share', async () => {
    const parts = phone({ 'content://docs/2': { name: 'kept.pdf', type: 'application/pdf' } })
    jest.mocked(parts.describe).mockImplementationOnce(() => {
      throw new Error('Permission denial')
    })

    const draft = await draftOf([text('Invoices'), file('content://docs/1', 'application/pdf'), file('content://docs/2', 'application/pdf')], parts)

    expect(draft?.description).toBe('Invoices')
    expect(draft?.files.map((each) => each.name)).toEqual(['kept.pdf'])
    expect(draft?.refused).toEqual([{ name: 'shared.pdf', refusal: 'UNREADABLE' }])
    expect(parts.copy).toHaveBeenCalledTimes(1)
  })

  it('says so of a HEIC photo that cannot be converted, and lets its copy go', async () => {
    const parts = phone({ 'file:///group/IMG_3.HEIC': { name: 'IMG_3.HEIC', type: 'image/heic' } })
    jest.mocked(parts.toJpeg).mockRejectedValue(new Error('damaged'))

    const draft = await draftOf([file('file:///group/IMG_3.HEIC', 'image/heic', 'image')], parts)

    expect(draft?.refused).toEqual([{ name: 'IMG_3.HEIC', refusal: 'UNREADABLE' }])
    expect(parts.discard).toHaveBeenCalledWith('file:///cache/shared/IMG_3.HEIC')
  })

  it('goes by the name when the share says a type the backend does not know by that spelling', async () => {
    const parts = phone({ 'content://media/5': { name: 'photo.jpg', type: 'image/jpg' } })

    const draft = await draftOf([file('content://media/5', 'image/jpg', 'image')], parts)

    expect(draft?.files.map((each) => each.type)).toEqual(['image/jpeg'])
  })

  it('takes as many files as a task holds, and says which were left out', async () => {
    const parts = phone({
      'content://media/1': { name: 'one.png', type: 'image/png' },
      'content://media/2': { name: 'two.png', type: 'image/png' },
      'content://media/3': { name: 'three.png', type: 'image/png' },
    })
    const shared = ['1', '2', '3'].map((id) => file(`content://media/${id}`, 'image/png', 'image'))

    const draft = await draftOf(shared, parts)

    expect(draft?.files.map((each) => each.name)).toEqual(['one.png', 'two.png'])
    expect(draft?.refused).toEqual([{ name: 'three.png', refusal: 'TASK_FULL' }])
    expect(parts.copy).toHaveBeenCalledTimes(2)
  })

  it('reads only what was shared: a link is taken as it was shared and never resolved', async () => {
    const parts = phone()

    await draftOf([{ shareType: 'url', value: 'https://example.com/a', mimeType: 'text/plain' }], parts)

    expect(parts.describe).not.toHaveBeenCalled()
    expect(parts.copy).not.toHaveBeenCalled()
  })
})

describe('the shared files themselves, once read (#356)', () => {
  it('are let go, each of them, whether taken or not -- on an iPhone they are the app’s to delete', async () => {
    const parts: IncomingParts = {
      ...phone({
        'file:///group/photo.jpg': { name: 'photo.jpg', type: 'image/jpeg' },
        'file:///group/notes.docx': { name: 'notes.docx', type: null },
        'file:///group/gone.pdf': { name: 'gone.pdf', type: 'application/pdf' },
      }),
      release: jest.fn(),
    }
    jest.mocked(parts.copy).mockImplementation(async (uri, name) => {
      if (uri.endsWith('gone.pdf')) {
        throw new Error('Permission denial')
      }
      return { uri: `file:///cache/shared/${name}`, size: 4_000 }
    })

    await draftOf(
      [
        text('Holiday'),
        file('file:///group/photo.jpg', 'image/jpeg'),
        file('file:///group/notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        file('file:///group/gone.pdf', 'application/pdf'),
      ],
      parts,
    )

    expect(jest.mocked(parts.release!).mock.calls.map(([uri]) => uri)).toEqual([
      'file:///group/photo.jpg',
      'file:///group/notes.docx',
      'file:///group/gone.pdf',
    ])
  })
})

describe('a share stays with the platform until its form opens (#432)', () => {
  /** expo-sharing's payloads, as the platform keeps them: in the App Group on an iPhone. */
  function inbox(...items: SharedItem[]): ShareInbox & { items: SharedItem[] } {
    const kept = {
      items,
      read: () => kept.items,
      clear: jest.fn(() => void (kept.items = [])),
    }
    return kept
  }
  const photo = file('file:///group/1/photo.jpg', 'image/jpeg')
  const parts = () => ({ ...phone({ 'file:///group/1/photo.jpg': { name: 'photo.jpg', type: 'image/jpeg' } }), release: jest.fn() })

  it('is read without being cleared, and its files are not let go yet', async () => {
    const platform = inbox(text('Holiday'), photo)
    const phoneParts = parts()

    const draft = await sharesFrom(platform, phoneParts).take()

    expect(draft).toMatchObject({ description: 'Holiday', files: [{ name: 'photo.jpg' }] })
    expect(platform.clear).not.toHaveBeenCalled()
    expect(phoneParts.release).not.toHaveBeenCalled()
  })

  it('is taken once in a run, however often the app comes back to the foreground', async () => {
    const shares = sharesFrom(inbox(text('Holiday')), parts())

    await shares.take()

    await expect(shares.take()).resolves.toBeNull()
  })

  it('is taken again by the next run when this one ended before its form opened', async () => {
    const platform = inbox(text('Holiday'))
    await sharesFrom(platform, parts()).take()

    await expect(sharesFrom(platform, parts()).take()).resolves.toMatchObject({ description: 'Holiday' })
  })

  it('is cleared, and its files let go, once its form opens', async () => {
    const platform = inbox(text('Holiday'), photo)
    const phoneParts = parts()
    const shares = sharesFrom(platform, phoneParts)
    const draft = (await shares.take())!

    shares.settle(draft)

    expect(platform.clear).toHaveBeenCalled()
    expect(phoneParts.release).toHaveBeenCalledWith('file:///group/1/photo.jpg')
  })

  it('leaves a newer share in place, which has replaced it there meanwhile', async () => {
    const platform = inbox(text('Holiday'))
    const shares = sharesFrom(platform, parts())
    const first = (await shares.take())!
    platform.items = [text('Groceries')]
    await shares.take()

    shares.settle(first)

    expect(platform.clear).not.toHaveBeenCalled()
  })

  it('takes the same share again once the last one was cleared', async () => {
    const platform = inbox(text('Holiday'))
    const shares = sharesFrom(platform, parts())
    shares.settle((await shares.take())!)
    platform.items = [text('Holiday')]

    await expect(shares.take()).resolves.toMatchObject({ description: 'Holiday' })
  })

  it('lets the files of an earlier run go before its first share is copied', async () => {
    const forgetLeft = jest.fn()
    const shares = sharesFrom(inbox(text('Holiday')), parts(), forgetLeft)

    await shares.take()
    await shares.take()

    expect(forgetLeft).toHaveBeenCalledTimes(1)
  })

  it('is nothing when nothing was shared', async () => {
    const forgetLeft = jest.fn()

    await expect(sharesFrom(inbox(), parts(), forgetLeft).take()).resolves.toBeNull()
    expect(forgetLeft).not.toHaveBeenCalled()
  })
})
