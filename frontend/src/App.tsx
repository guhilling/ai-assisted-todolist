/**
 * The app shell: session and board state, and the composition of the pieces that render them.
 *
 * The wire lives in `api.ts` and the due-date words in `dates.ts`, so what remains here is
 * state and the decisions that depend on more than one piece of it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  apiBaseUrl,
  authLogoutUrl,
  deleteTask,
  BackendPausedError,
  fetchAuthProviders,
  fetchEnvironmentName,
  fetchCurrentUser,
  fetchTasks,
  postTask,
  putTask,
  restoreTask,
  SessionExpiredError,
  toErrorMessage,
  type AuthProvidersResponse,
  type CurrentUser,
  type Task,
  type TaskInput,
  type TaskState,
} from './api'
import AddTaskRow from './components/AddTaskRow'
import type { TaskEdit } from './components/TaskEditor'
import CompletedSection from './components/CompletedSection'
import LegalFooter from './components/LegalFooter'
import Paused from './components/Paused'
import SignedOut from './components/SignedOut'
import TaskSection from './components/TaskSection'
import UserAvatar from './components/UserAvatar'
import UndoToast from './components/UndoToast'
import { bucketOf, todayIso, type DueBucket } from './dates'
import { useI18n } from './i18n/context'
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
  const { messages } = useI18n()
  const [tasks, setTasks] = useState<Task[]>([])
  const [providers, setProviders] = useState<AuthProvidersResponse>({ enabled: false, providers: [] })
  // While the environment is down, the name it gives itself, or null; undefined while it is up.
  const [paused, setPaused] = useState<{ environmentName: string | null } | undefined>(undefined)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  // What failed, not yet put into words: the banner says it in whatever language is spoken when it
  // renders, so switching language translates a banner already on screen too.
  const [error, setError] = useState<{ cause: unknown; fallback: keyof Messages['failures'] } | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
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
        .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.id - right.id),
    [tasks],
  )

  const completedTasks = useMemo(
    () => [...tasks].filter((task) => task.state === 'DONE').sort((left, right) => right.dueDate.localeCompare(left.dueDate)),
    [tasks],
  )

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
      } catch (failure) {
        if (failure instanceof BackendPausedError) {
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
   * completed section calls this in a loop and a captured array would be a render behind by
   * the second iteration.
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
    const gone: Task[] = []
    for (const task of completedTasks) {
      if (await deleteOne(task)) {
        gone.push(task)
      }
    }
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

  /** Returns whether the task was saved, so the add row knows whether to clear itself. */
  const addTask = async (input: TaskInput) => {
    setSaving(true)
    setError(null)

    try {
      const created = await postTask(input)
      setTasks((current) => [...current, created])
      return true
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
            {toErrorMessage(error.cause, messages.failures[error.fallback], messages.errors)}
          </p>
        ) : null}
        {sessionExpired ? (
          <p className="session-notice" role="status" aria-live="polite">
            {messages.board.sessionExpired}
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
        </div>
      </header>

      {error ? (
        <p className="error-banner" role="status" aria-live="polite">
          {toErrorMessage(error.cause, messages.failures[error.fallback], messages.errors)}
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
          <AddTaskRow today={today} saving={saving} onAdd={addTask} />

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
            />
          ))}

          <CompletedSection
            tasks={completedTasks}
            today={today}
            onToggleDone={toggleDone}
            onSetState={setTaskState}
            onDelete={removeTask}
            onClear={clearCompleted}
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
