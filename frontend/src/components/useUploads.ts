import { useRef, useState } from 'react'
import type { Task } from '../api'
import { useI18n } from '../i18n/context'
import type { AttachmentActions } from './AttachmentList'

/** A file on its way up, with how far it has got. */
export type Upload = { key: number; fileName: string; fraction: number }

/** A sentence about a file that did not make it, keyed on its own: two can read the same. */
export type Problem = { key: number; text: string }

/**
 * Uploading files to a task, with a progress bar each and a sentence for each that did not make it
 * -- what the editor (#204) and the add row (#216) both show. Files go up in parallel; the backend
 * serialises the limit checks per user, so one past a limit is refused with its reason like any
 * other. It needs only the upload itself, and none at all where no file can be chosen.
 */
export function useUploads(upload: AttachmentActions['upload'] | undefined) {
  const { messages } = useI18n()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problems, setProblems] = useState<Problem[]>([])
  const nextKey = useRef(0)

  const keyed = () => {
    nextKey.current += 1
    return nextKey.current
  }

  const addProblem = (text: string) => setProblems((current) => [...current, { key: keyed(), text }])

  const uploadOne = async (task: Task, file: File) => {
    if (!upload) {
      addProblem(messages.attachments.uploadFailed(file.name))
      return
    }
    const key = keyed()
    setUploads((current) => [...current, { key, fileName: file.name, fraction: 0 }])
    const outcome = await upload(task, file, (fraction) =>
      setUploads((current) => current.map((each) => (each.key === key ? { ...each, fraction } : each))),
    )
    setUploads((current) => current.filter((each) => each.key !== key))
    if ('refusal' in outcome) {
      addProblem(messages.attachments.refusals[outcome.refusal](file.name))
    } else if ('failed' in outcome) {
      addProblem(messages.attachments.uploadFailed(file.name))
    }
  }

  return {
    uploads,
    problems,
    /** Adds a sentence of its own, for a file refused before any upload. */
    addProblem,
    clearProblems: () => setProblems([]),
    /** Uploads these files to the task, all at once, and resolves when every one has finished. */
    uploadAll: async (task: Task, files: File[]) => {
      await Promise.all(files.map((file) => uploadOne(task, file)))
    },
  }
}

/**
 * Splits chosen files into those the task has room for and those beyond it, in the order chosen:
 * a file past the limit is refused in the browser, not sent only to be refused by the backend.
 */
export function withinRoom(files: File[], room: number) {
  return { fitting: files.slice(0, Math.max(room, 0)), beyond: files.slice(Math.max(room, 0)) }
}
