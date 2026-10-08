import { useRef, useState } from 'react'
import type { Task } from '../api'
import { useI18n } from '../i18n/context'
import type { AttachmentActions } from './AttachmentList'

/** A file on its way up, with how far it has got. */
export type Upload = { key: number; fileName: string; fraction: number }

/**
 * Uploading files to a task, with a progress bar each and a sentence for each that did not make it
 * -- what the editor (#204) and the add row (#216) both show. Files go up in parallel; the backend
 * serialises the limit checks per user, so one past a limit is refused with its reason like any
 * other.
 */
export function useUploads(actions: AttachmentActions) {
  const { messages } = useI18n()
  const [uploads, setUploads] = useState<Upload[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const nextKey = useRef(0)

  const uploadOne = async (task: Task, file: File) => {
    nextKey.current += 1
    const key = nextKey.current
    setUploads((current) => [...current, { key, fileName: file.name, fraction: 0 }])
    const outcome = await actions.upload(task, file, (fraction) =>
      setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, fraction } : upload))),
    )
    setUploads((current) => current.filter((upload) => upload.key !== key))
    if ('refusal' in outcome) {
      setProblems((current) => [...current, messages.attachments.refusals[outcome.refusal](file.name)])
    } else if ('failed' in outcome) {
      setProblems((current) => [...current, messages.attachments.uploadFailed(file.name)])
    }
  }

  return {
    uploads,
    problems,
    /** Adds a sentence of its own, for a file refused before any upload. */
    addProblem: (problem: string) => setProblems((current) => [...current, problem]),
    clearProblems: () => setProblems([]),
    /** Uploads these files to the task, all at once, and resolves when every one has finished. */
    uploadAll: async (task: Task, files: File[]) => {
      await Promise.all(files.map((file) => uploadOne(task, file)))
    },
  }
}
