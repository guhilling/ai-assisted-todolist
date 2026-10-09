/**
 * The app shell: session and board state, and the composition of the pieces that render them.
 *
 * The wire lives in `api.ts` and the due-date words in `dates.ts`, so what remains here is
 * state and the decisions that depend on more than one piece of it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  AttachmentRefusedError,
  attachmentLink,
  thumbnailLink,
  apiBaseUrl,
  authLogoutUrl,
  deleteTask,
  BackendPausedError,
  deleteAccount,
  fetchAuthProviders,
  fetchEnvironmentName,
  fetchCurrentUser,
  fetchTasks,
  postTask,
  putTask,
  removeAttachment,
  restoreTask,
  SessionExpiredError,
  uploadAttachment,
  type Attachment,
  type AuthProvidersResponse,
  type CurrentUser,
  type Task,
  type TaskInput,
  type TaskState,
} from './api'
import { rememberAccountDeleted, takeAccountDeleted } from './accountDeleted'
import AccountDeletion from './components/AccountDeletion'
import AddTaskRow from './components/AddTaskRow'
import type { AttachmentActions, UploadOutcome } from './components/AttachmentList'
import type { TaskEdit } from './components/TaskEditor'
import CompletedSection from './components/CompletedSection'
import LegalFooter from './components/LegalFooter'
import Paused from './components/Paused'
import SignedOut from './components/SignedOut'
import TaskSection from './components/TaskSection'
import UserAvatar from './components/UserAvatar'
import UndoToast from './components/UndoToast'
import { bucketOf, todayIso, type DueBucket } from './dates'
import { compareCompleted, compareOpen } from './importance'
import { useI18n } from './i18n/context'
import { describeFailure } from './i18n/failures'
import type { Messages } from './i18n/messages'
import { I18nProvider } from './i18n/I18nProvider'

/**
 * The dated sections, in the order they appear. `Completed` is handled separately. A section's
 * title is its bucket's word in the catalogue (#203).
 */
const sections: { bucket: DueBucket; overdue?: boolean }[] = [
  { bucket: 'overdue', overdue: true },
  { bucket: 'today' },
  { bucket: 'tomorrow' },
  { bucket: 'thisWeek' },
  { bucket: 'later' },
]

/**
 * A link that shows a file. Here rather than in the board, so it is one function for the app's
 * lifetime and a preview asks for its link once, not on every render of the board.
 */
const linkToAttachment = (taskId: Task['id'], attachmentId: Attachment['id'], thumbnail: boolean) =>
  thumbnail ? thumbnailLink(taskId, attachmentId) : attachmentLink(taskId, attachmentId)

/** The app, speaking the visitor's language to everything in it (#203). */
function App() {
  return (
    <I18nProvider>
      <Board />
    </I18nProvider>
  )
}

/** Everything the app shows: the signed-out and paused pages, and the board. */
function Board() {
  const { language, messages } = useI18n()
  const [tasks, setTasks] = useState<Task[]>([])
  const [providers, setProviders] = useState<AuthProvidersResponse>({ enabled: false, providers: [] })
  // While the environment is down, the name it gives itself, or null; undefined while it is up.
  const [paused, setPaused] = useState<{ environmentName: string | null } | undefined>(undefined)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  // What failed, not yet put into words: the banner says it in whatever language is spoken when it
  // renders, so switching language translates a banner already on screen too.
  const [error, setError] = useState<{ cause: unknown; fallback: keyof Messages['failures'] } | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  // Read once on mount: the sign-out after deleting an account comes back here (#213).
  const [accountDeleted] = useState(takeAccountDeleted)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleted, setDeleted] = useState<Task[] | null>(null)

  /**
   * Read once per mount rather than per render, so a board left open overnight does not
   * reshuffle itself mid-interaction. A stale "Today" heading is a smaller surprise than rows
   * moving under the pointer.
   */
  const [today] = useState(() => todayIso())

  const openTasks = useMemo(
    () =>
      [...tasks]
        .filter((task) => task.state !== 'DONE')
        .sort(compareOpen),
    [tasks],
  )

  const completedTasks = useMemo(
    () => [...tasks].filter((task) => task.state === 'DONE').sort(compareCompleted),
    [tasks],
  )

  /**
   * Reports a failed request. A session that has ended is not a failure of the request that
   * noticed it, so it signs the board out and says why, instead of showing an error message.
   */
  const reportFailure = (failure: unknown, fallback: keyof Messages['failures']) => {
    if (failure instanceof SessionExpiredError) {
      setError(null)
      setSessionExpired(true)
      setCurrentUser(null)
      return
    }
    setError({ cause: failure, fallback })
  }

  useEffect(() => {
    /**
     * Loaded on its own, not alongside the session probe.
     *
     * The signed-out page is nothing but this list, and `/api/auth/me` is slow on a cold
     * backend because the first authenticated request triggers OIDC discovery. Waiting for
     * both left the sign-in button missing for seconds on a fresh deployment.
     */
    const loadProviders = async () => {
      try {
        const authProviders = await fetchAuthProviders()
        if (authProviders) {
          setProviders(authProviders)
        }
      } catch (error_) {
        if (error_ instanceof BackendPausedError) {
          setPaused({ environmentName: await fetchEnvironmentName() })
        }
        // Anything else: nothing depends on this, and the page says sign-in is unconfigured.
      }
    }

    const loadSession = async () => {
      try {
        const user = await fetchCurrentUser()
        setCurrentUser(user)

        if (!user) {
          return
        }

        setTasks(await fetchTasks())
      } catch (loadError) {
        reportFailure(loadError, 'loading')
      } finally {
        setLoading(false)
      }
    }

    void loadProviders()
    void loadSession()
  }, [])


  const replaceTask = (updated: Task) =>
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)))

  /**
   * Saves a state change, showing it before the server has agreed.
   *
   * Ticking a checkbox has to feel immediate, and a round trip does not. The previous task is
   * put back if the save fails, so a rejected change never leaves the board claiming something
   * untrue.
   */
  const saveState = async (task: Task, nextState: TaskState) => {
    const previous = task
    setError(null)
    replaceTask({ ...task, state: nextState })

    try {
      replaceTask(await putTask({ ...task, state: nextState }))
    } catch (updateError) {
      replaceTask(previous)
      reportFailure(updateError, 'updating')
    }
  }

  /**
   * Saves an edit, waiting for the server rather than showing it first.
   *
   * Unlike a tick, an edit is a form someone has just filled in, so a moment's "Saving…" is
   * expected -- and keeping the form open until the server agrees means a refused edit leaves
   * what was typed in place to correct, instead of rolling the row back and losing it.
   */
  const editTask = async (task: Task, changes: TaskEdit) => {
    setError(null)

    try {
      replaceTask(await putTask({ ...task, ...changes }))
      return true
    } catch (updateError) {
      reportFailure(updateError, 'updating')
      return false
    }
  }

  const toggleDone = (task: Task) => void saveState(task, task.state === 'DONE' ? 'TODO' : 'DONE')
  const setTaskState = (task: Task, state: TaskState) => void saveState(task, state)

  /**
   * Deletes one task, putting the row back if the server refuses. Says whether it went.
   *
   * The rollback uses the updater form rather than a captured `tasks`, because clearing the
   * completed section calls this for several tasks at once, and a captured array would be a
   * render behind for all but the first.
   */
  const deleteOne = async (task: Task) => {
    setTasks((current) => current.filter((candidate) => candidate.id !== task.id))

    try {
      await deleteTask(task)
      return true
    } catch (deleteError) {
      setTasks((current) => [...current, task])
      reportFailure(deleteError, 'deleting')
      return false
    }
  }

  const removeTask = async (task: Task) => {
    setError(null)
    if (await deleteOne(task)) {
      setDeleted([task])
    }
  }

  const clearCompleted = async () => {
    setError(null)
    // All at once: each deletion stands on its own, and the undo offers those that went.
    const outcomes = await Promise.all(completedTasks.map(async (task) => ((await deleteOne(task)) ? task : null)))
    const gone = outcomes.filter((task): task is Task => task !== null)
    if (gone.length > 0) {
      setDeleted(gone)
    }
  }

  /** Stable, so that a re-render of the board does not restart the undo countdown. */
  const dismissUndo = useCallback(() => setDeleted(null), [])

  const restoreDeleted = async (tasksToRestore: Task[]) => {
    setDeleted(null)
    setError(null)

    try {
      const restored = await Promise.all(tasksToRestore.map((task) => restoreTask(task, today)))
      setTasks((current) => [...current, ...restored])
    } catch (restoreError) {
      reportFailure(restoreError, 'restoring')
    }
  }

  /** Sets a task's files, leaving everything else about it as the board has it. */
  const setAttachments = (taskId: Task['id'], change: (current: Attachment[]) => Attachment[]) =>
    setTasks((current) =>
      current.map((candidate) =>
        candidate.id === taskId ? { ...candidate, attachments: change(candidate.attachments ?? []) } : candidate,
      ),
    )

  /**
   * What the rows and the editor do with files (#204). Opening asks for a link only on the click,
   * because a link works for minutes and a board stays open for hours; the tab is opened first,
   * on the click itself, since a browser blocks one opened after a request has come back.
   */
  const attachmentActions: AttachmentActions = {
    link: linkToAttachment,
    open: (task, attachment) => {
      setError(null)
      const tab = window.open('', '_blank')
      attachmentLink(task.id, attachment.id)
        .then((url) => {
          if (tab) {
            // The new tab must not be able to reach back into the board.
            tab.opener = null
            tab.location.href = url
          }
        })
        .catch((openError: unknown) => {
          tab?.close()
          reportFailure(openError, 'loading')
        })
    },
    remove: (task, attachment) => {
      setError(null)
      removeAttachment(task.id, attachment.id)
        .then(() => setAttachments(task.id, (current) => current.filter((kept) => kept.id !== attachment.id)))
        .catch((removeError: unknown) => reportFailure(removeError, 'deleting'))
    },
    upload: async (task, file, onProgress): Promise<UploadOutcome> => {
      try {
        const attachment = await uploadAttachment(task.id, file, onProgress)
        setAttachments(task.id, (current) => [...current, attachment])
        return { ok: true }
      } catch (uploadError) {
        if (uploadError instanceof AttachmentRefusedError) {
          return { refusal: uploadError.refusal }
        }
        if (uploadError instanceof SessionExpiredError) {
          reportFailure(uploadError, 'saving')
        }
        return { failed: true }
      }
    },
  }

  /**
   * Deletes the account (#213), then signs out by navigating to the sign-out, which ends the
   * session the backend still holds and comes back to the signed-out page.
   */
  const deleteMyAccount = async () => {
    setError(null)
    try {
      await deleteAccount()
      rememberAccountDeleted()
      window.location.assign(authLogoutUrl)
      return true
    } catch (deleteError) {
      reportFailure(deleteError, 'deleting')
      return false
    }
  }

  /** Returns the task as created, or false, so the add row knows whether to clear itself and where its files go. */
  const addTask = async (input: TaskInput) => {
    setSaving(true)
    setError(null)

    try {
      const created = await postTask(input)
      setTasks((current) => [...current, created])
      return created
    } catch (saveError) {
      reportFailure(saveError, 'saving')
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!currentUser) {
    return (
      <main className="app">
        {error ? (
          <p className="error-banner" role="status" aria-live="polite">
            {describeFailure(error.cause, messages.failures[error.fallback], messages, language)}
          </p>
        ) : null}
        {sessionExpired ? (
          <p className="session-notice" role="status" aria-live="polite">
            {messages.board.sessionExpired}
          </p>
        ) : null}
        {accountDeleted ? (
          <p className="session-notice" role="status" aria-live="polite">
            {messages.account.deleted}
          </p>
        ) : null}
        {paused ? (
          <Paused environmentName={paused.environmentName} />
        ) : (
          <SignedOut providers={providers} apiBaseUrl={apiBaseUrl} />
        )}
        <LegalFooter />
      </main>
    )
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">TaskFest</h1>
        <div className="app-identity">
          <UserAvatar email={currentUser.email} name={currentUser.name} pictureUrl={currentUser.pictureUrl} />
          <span className="app-email">{currentUser.name ?? currentUser.email}</span>
          <a className="text-link" href={authLogoutUrl}>
            {messages.app.signOut}
          </a>
          <AccountDeletion email={currentUser.email} onDelete={deleteMyAccount} />
        </div>
      </header>

      {error ? (
        <p className="error-banner" role="status" aria-live="polite">
          {describeFailure(error.cause, messages.failures[error.fallback], messages, language)}
        </p>
      ) : null}

      {/*
        * Nothing is interactive until the board has arrived. The list request replaces the
        * whole array when it resolves, so anything added or ticked while it was still in
        * flight was silently thrown away -- which a slow backend made easy to hit and mock
        * driven tests, answering instantly, could never show.
        */}
      {loading ? (
        <p className="board-note">{messages.board.loading}</p>
      ) : (
        <>
          <AddTaskRow today={today} saving={saving} onAdd={addTask} attachments={attachmentActions} />

          {sections.map((section) => (
            <TaskSection
              key={section.bucket}
              title={messages.sections[section.bucket]}
              overdue={section.overdue}
              today={today}
              tasks={openTasks.filter((task) => bucketOf(task.dueDate, today) === section.bucket)}
              onToggleDone={toggleDone}
              onSetState={setTaskState}
              onDelete={removeTask}
              onEdit={editTask}
              attachments={attachmentActions}
            />
          ))}

          <CompletedSection
            tasks={completedTasks}
            today={today}
            onToggleDone={toggleDone}
            onSetState={setTaskState}
            onDelete={removeTask}
            onClear={clearCompleted}
            attachments={attachmentActions}
          />

          {tasks.length === 0 ? <p className="board-note">{messages.board.empty}</p> : null}
        </>
      )}


      {deleted ? (
        <UndoToast
          count={deleted.length}
          onUndo={() => void restoreDeleted(deleted)}
          onDismiss={dismissUndo}
        />
      ) : null}
      <LegalFooter />
    </main>
  )
}

export default App
