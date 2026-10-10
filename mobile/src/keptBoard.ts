import type { BoardTask } from './api'
import { validateTaskResponse } from './web'

/**
 * The last board the app loaded, kept on the phone so it can be read without a connection (#272).
 *
 * Read only: the app shows it, never changes it, until a load replaces it -- editing offline would
 * need optimistic locking first (`doc/decisions/mobile-app.md`). It names the account it belongs
 * to, so a different sign-in is never shown someone else's tasks, and signing out forgets it.
 */
export type KeptBoard = {
  /** The signed-in address it was loaded for. */
  account: string
  /** When it was kept, in milliseconds since the epoch: what the board was "as of". */
  savedAt: number
  tasks: BoardTask[]
}

/** Keeps, hands back and forgets the one board the app keeps. */
export type KeptBoardStore = {
  load(): Promise<KeptBoard | null>
  save(board: KeptBoard): Promise<void>
  clear(): Promise<void>
}

/** The part of expo-file-system's `File` this needs, so tests can keep the board in memory. */
export type TextFile = {
  readonly exists: boolean
  text(): Promise<string>
  write(text: string): void
  delete(): void
}

/**
 * Whether a kept task is still one this release can show: checked against the schema like a loaded
 * one, its list of values it did not know (#268) aside. A file it cannot read whole is no board.
 */
function isKeptTask(item: unknown): item is BoardTask {
  if (typeof item !== 'object' || item === null) {
    return false
  }
  const { unknown, ...task } = item as BoardTask
  return (
    validateTaskResponse(task) &&
    (unknown === undefined || (Array.isArray(unknown) && unknown.every((value) => value === 'importance' || value === 'state')))
  )
}

/** The file's layout; a later release that changes it raises this, and an older one ignores it. */
const FORMAT = 1

/**
 * The board kept in one JSON file. The app keeps it in its cache directory: it is a copy of what
 * the backend holds, which the system may clear and which is not worth a backup -- and the
 * platform's sandbox keeps it from other apps.
 */
export function createKeptBoardStore(file: TextFile): KeptBoardStore {
  return {
    async load() {
      if (!file.exists) {
        return null
      }
      try {
        const kept = JSON.parse(await file.text()) as Partial<KeptBoard> & { version?: unknown }
        if (
          kept.version !== FORMAT ||
          typeof kept.account !== 'string' ||
          typeof kept.savedAt !== 'number' ||
          !Array.isArray(kept.tasks) ||
          !kept.tasks.every(isKeptTask)
        ) {
          return null
        }
        return { account: kept.account, savedAt: kept.savedAt, tasks: kept.tasks }
      } catch {
        return null
      }
    },

    async save(board) {
      file.write(JSON.stringify({ version: FORMAT, ...board }))
    },

    async clear() {
      if (file.exists) {
        file.delete()
      }
    },
  }
}
