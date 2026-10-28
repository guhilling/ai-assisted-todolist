import { createPreviewStore, type PreviewFolder } from './previews'

/** A folder in memory: a file's "content" is the link it was downloaded from. */
function memoryFolder(): PreviewFolder & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    find: (name) => (files.has(name) ? `file:///previews/${name}` : null),
    download: async (url, name) => {
      if (url.includes('offline')) {
        throw new Error('no connection')
      }
      files.set(name, url)
      return `file:///previews/${name}`
    },
    names: () => [...files.keys()],
    remove: (name) => void files.delete(name),
    clear: () => files.clear(),
  }
}

describe('the previews kept on the phone (#397)', () => {
  it('keeps a preview by its attachment, and finds it again', async () => {
    const store = createPreviewStore(memoryFolder())

    await expect(store.keep(3, 'https://bucket.example.com/1/3/thumbnail')).resolves.toBe('file:///previews/3')

    await expect(store.find(3)).resolves.toBe('file:///previews/3')
  })

  it('has none for an attachment it never kept', async () => {
    await expect(createPreviewStore(memoryFolder()).find(3)).resolves.toBeNull()
  })

  it('fails to keep one that cannot be downloaded, and keeps nothing for it', async () => {
    const folder = memoryFolder()
    const store = createPreviewStore(folder)

    await expect(store.keep(3, 'https://offline.example.com/1/3/thumbnail')).rejects.toThrow('no connection')

    await expect(store.find(3)).resolves.toBeNull()
  })

  it('keeps only the previews of the attachments still on the board', async () => {
    const folder = memoryFolder()
    const store = createPreviewStore(folder)
    await store.keep(3, 'https://bucket.example.com/1/3/thumbnail')
    await store.keep(4, 'https://bucket.example.com/1/4/file')
    folder.files.set('stray.tmp', 'left by a download cut short')

    await store.retain([4, 5])

    expect(folder.names()).toEqual(['4'])
  })

  it('forgets them all', async () => {
    const folder = memoryFolder()
    const store = createPreviewStore(folder)
    await store.keep(3, 'https://bucket.example.com/1/3/thumbnail')

    await store.clear()

    await expect(store.find(3)).resolves.toBeNull()
  })
})
