import { createPreviewStore, type PreviewFolder } from './previews'

/**
 * A folder in memory: a file's "content" is the link it was downloaded from. A download waits
 * until it is let through when `held`, so a test can act while one is on its way.
 */
function memoryFolder(held = false) {
  const files = new Map<string, string>()
  const waiting: (() => void)[] = []
  const downloads: string[] = []
  const folder: PreviewFolder = {
    find: (name) => (files.has(name) ? `file:///previews/${name}` : null),
    download: async (url, name) => {
      downloads.push(url)
      files.set(name, 'part of ' + url)
      if (held) {
        await new Promise<void>((resolve) => waiting.push(resolve))
      }
      if (url.includes('offline')) {
        throw new Error('no connection')
      }
      files.set(name, url)
    },
    move: (from, to) => {
      const content = files.get(from)
      if (content === undefined) {
        throw new Error(`no such file: ${from}`)
      }
      files.delete(from)
      files.set(to, content)
      return `file:///previews/${to}`
    },
    names: () => [...files.keys()],
    remove: (name) => void files.delete(name),
    clear: () => files.clear(),
  }
  return { folder, files, downloads, letThrough: () => waiting.splice(0).forEach((resolve) => resolve()) }
}

describe('the previews kept on the phone (#397)', () => {
  it('keeps a preview by its attachment, and finds it again', async () => {
    const store = createPreviewStore(memoryFolder().folder)

    await expect(store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')).resolves.toBe('file:///previews/3')

    await expect(store.find(3, true)).resolves.toBe('file:///previews/3')
  })

  it('has none for an attachment it never kept', async () => {
    await expect(createPreviewStore(memoryFolder().folder).find(3, true)).resolves.toBeNull()
  })

  it('keeps a thumbnail and the file itself apart', async () => {
    const { folder, files } = memoryFolder()
    const store = createPreviewStore(folder)

    await store.keep(3, false, 'https://bucket.example.com/1/3/file')

    await expect(store.find(3, true)).resolves.toBeNull()
    await expect(store.find(3, false)).resolves.toBe('file:///previews/3-file')
    expect(files.get('3-file')).toBe('https://bucket.example.com/1/3/file')
  })

  it('fails to keep one that cannot be downloaded, and leaves nothing of it', async () => {
    const { folder, files } = memoryFolder()
    const store = createPreviewStore(folder)

    await expect(store.keep(3, true, 'https://offline.example.com/1/3/thumbnail')).rejects.toThrow('no connection')

    await expect(store.find(3, true)).resolves.toBeNull()
    expect(files.size).toBe(0)
  })

  it('downloads a preview asked for twice at once only once', async () => {
    const { folder, downloads, letThrough } = memoryFolder(true)
    const store = createPreviewStore(folder)

    const first = store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')
    const second = store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')
    letThrough()

    await expect(Promise.all([first, second])).resolves.toEqual(['file:///previews/3', 'file:///previews/3'])
    expect(downloads).toHaveLength(1)
  })

  it('keeps only the previews of the attachments still on the board', async () => {
    const { folder, files } = memoryFolder()
    const store = createPreviewStore(folder)
    await store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')
    await store.keep(4, false, 'https://bucket.example.com/1/4/file')
    files.set('4.7.part', 'left by a download a run cut short')

    await store.retain([4, 5])

    expect([...files.keys()]).toEqual(['4-file'])
  })

  it('lets a download on its way finish when its attachment is still on the board', async () => {
    const { folder, letThrough } = memoryFolder(true)
    const store = createPreviewStore(folder)
    const keeping = store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')

    await store.retain([3])
    letThrough()

    await expect(keeping).resolves.toBe('file:///previews/3')
  })

  it('does not keep a download that arrives after its attachment left the board', async () => {
    const { folder, files, letThrough } = memoryFolder(true)
    const store = createPreviewStore(folder)
    const keeping = store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')

    await store.retain([4])
    letThrough()

    await expect(keeping).rejects.toThrow('no longer wanted')
    expect(files.size).toBe(0)
  })

  it('forgets them all', async () => {
    const { folder } = memoryFolder()
    const store = createPreviewStore(folder)
    await store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')

    await store.clear()

    await expect(store.find(3, true)).resolves.toBeNull()
  })

  it('does not keep a download that arrives after they were forgotten', async () => {
    const { folder, files, letThrough } = memoryFolder(true)
    const store = createPreviewStore(folder)
    const keeping = store.keep(3, true, 'https://bucket.example.com/1/3/thumbnail')

    await store.clear()
    letThrough()

    await expect(keeping).rejects.toThrow('no longer wanted')
    expect(files.size).toBe(0)
  })
})
