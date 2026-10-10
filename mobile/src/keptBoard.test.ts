import type { BoardTask } from './api'
import { createKeptBoardStore, type TextFile } from './keptBoard'

const water: BoardTask = { id: 1, description: 'Water the plants', dueDate: '2026-10-10', importance: 'HIGH', state: 'TODO' }

function memoryFile(initial?: string): TextFile & { content: () => string | undefined } {
  let content = initial
  return {
    content: () => content,
    get exists() {
      return content !== undefined
    },
    text: async () => {
      if (content === undefined) {
        throw new Error('no such file')
      }
      return content
    },
    write: (text) => void (content = text),
    delete: () => void (content = undefined),
  }
}

describe('the board kept on the phone (#272)', () => {
  it('keeps a board for its account, and hands it back', async () => {
    const store = createKeptBoardStore(memoryFile())

    await store.save({ account: 'ada@example.com', savedAt: 1000, tasks: [water] })

    await expect(store.load()).resolves.toEqual({ account: 'ada@example.com', savedAt: 1000, tasks: [water] })
  })

  it('has none until one was kept', async () => {
    await expect(createKeptBoardStore(memoryFile()).load()).resolves.toBeNull()
  })

  it('forgets it', async () => {
    const file = memoryFile()
    const store = createKeptBoardStore(file)
    await store.save({ account: 'ada@example.com', savedAt: 1000, tasks: [water] })

    await store.clear()

    expect(file.exists).toBe(false)
    await expect(store.load()).resolves.toBeNull()
  })

  it('forgets nothing it does not have', async () => {
    await expect(createKeptBoardStore(memoryFile()).clear()).resolves.toBeUndefined()
  })

  it('reads a board with a task it cannot make sense of as none', async () => {
    const broken = JSON.stringify({ version: 1, account: 'ada@example.com', savedAt: 1, tasks: [water, {}] })

    await expect(createKeptBoardStore(memoryFile(broken)).load()).resolves.toBeNull()
    const nothing = JSON.stringify({ version: 1, account: 'ada@example.com', savedAt: 1, tasks: [null] })
    await expect(createKeptBoardStore(memoryFile(nothing)).load()).resolves.toBeNull()
  })

  it('keeps a task a newer backend gave a value this release does not know, marked as such', async () => {
    const unknown: BoardTask = { ...water, importance: 'LOW', unknown: ['importance'] }
    const store = createKeptBoardStore(memoryFile())

    await store.save({ account: 'ada@example.com', savedAt: 1000, tasks: [unknown] })

    await expect(store.load()).resolves.toEqual({ account: 'ada@example.com', savedAt: 1000, tasks: [unknown] })
  })

  it('reads a file it cannot make sense of as none', async () => {
    await expect(createKeptBoardStore(memoryFile('not json')).load()).resolves.toBeNull()
    await expect(createKeptBoardStore(memoryFile('{"version":1,"tasks":[]}')).load()).resolves.toBeNull()
    // Written by a later release in a shape this one does not know.
    await expect(
      createKeptBoardStore(memoryFile('{"version":2,"account":"ada@example.com","savedAt":1,"tasks":[]}')).load(),
    ).resolves.toBeNull()
  })
})
