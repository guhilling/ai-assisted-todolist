import { fileFlag } from './fileFlag'
import type { TextFile } from './keptBoard'

/** A question answered once on the phone, remembered by a file existing (#335). */
function memoryFile(): TextFile & { written: string[] } {
  const written: string[] = []
  return {
    written,
    get exists() {
      return written.length > 0
    },
    text: async () => written.at(-1) ?? '',
    write: (text) => void written.push(text),
    delete: () => void written.splice(0),
  }
}

describe('a flag kept as a file (#335)', () => {
  it('is unset until set, and set from then on', async () => {
    const file = memoryFile()
    const flag = fileFlag(file, 'explained')

    await expect(flag.seen()).resolves.toBe(false)
    await flag.dismiss()

    await expect(flag.seen()).resolves.toBe(true)
    expect(file.written).toEqual(['explained'])
  })
})
