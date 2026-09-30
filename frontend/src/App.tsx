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
  fetchAuthProviders,
  fetchCurrentUser,
  fetchTasks,
  postTask,
  putTask,
  restoreTask,
  toErrorMessage,
  type AuthProvidersResponse,
  type CurrentUser,
  type Task,
  type TaskInput,
  type TaskState,
} from './api'
import AddTaskRow from './components/AddTaskRow'
import CompletedSection from './components/CompletedSection'
import SignedOut, { purposeUrl } from './components/SignedOut'
import TaskSection from './components/TaskSection'
import UserAvatar from './components/UserAvatar'
import UndoToast from './components/UndoToast'
import { bucketOf, todayIso, type DueBucket } from './dates'

/** The dated sections, in the order they appear. `Completed` is handled separately. */
const sections: { bucket: DueBucket; title: string; overdue?: boolean }[] = [
  { bucket: 'overdue', title: 'Overdue', overdue: true },
  { bucket: 'today', title: 'Today' },
  { bucket: 'tomorrow', title: 'Tomorrow' },
  { bucket: 'thisWeek', title: 'This week' },
  { bucket: 'later', title: 'Later' },
]

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [providers, setProviders] = useState<AuthProvidersResponse>({ enabled: false, providers: [] })
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      } catch {
        // Nothing else depends on this; the page falls back to saying sign-in is unconfigured.
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
        setError(toErrorMessage(loadError, 'Unexpected error while loading data.'))
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
      setError(toErrorMessage(updateError, 'Unexpected error while updating data.'))
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
      setError(toErrorMessage(deleteError, 'Unexpected error while deleting data.'))
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
      setError(toErrorMessage(restoreError, 'Unexpected error while restoring data.'))
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
      setError(toErrorMessage(saveError, 'Unexpected error while saving data.'))
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
            {error}
          </p>
        ) : null}
        <SignedOut providers={providers} apiBaseUrl={apiBaseUrl} />
      </main>
    )
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">Tasks</h1>
        <div className="app-identity">
          <UserAvatar email={currentUser.email} name={currentUser.name} pictureUrl={currentUser.pictureUrl} />
          <span className="app-email">{currentUser.name ?? currentUser.email}</span>
          <a className="text-link" href={authLogoutUrl}>
            Sign out
          </a>
        </div>
      </header>

      {error ? (
        <p className="error-banner" role="status" aria-live="polite">
          {error}
        </p>
      ) : null}

      {/*
        * Nothing is interactive until the board has arrived. The list request replaces the
        * whole array when it resolves, so anything added or ticked while it was still in
        * flight was silently thrown away -- which a slow backend made easy to hit and mock
        * driven tests, answering instantly, could never show.
        */}
      {loading ? (
        <p className="board-note">Loading tasks…</p>
      ) : (
        <>
          <AddTaskRow today={today} saving={saving} onAdd={addTask} />

          {sections.map((section) => (
            <TaskSection
              key={section.bucket}
              title={section.title}
              overdue={section.overdue}
              today={today}
              tasks={openTasks.filter((task) => bucketOf(task.dueDate, today) === section.bucket)}
              onToggleDone={toggleDone}
              onSetState={setTaskState}
              onDelete={removeTask}
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

          {tasks.length === 0 ? <p className="board-note">Nothing here yet. Add your first task.</p> : null}
        </>
      )}

      <footer className="app-footer">
        <a className="text-link" href={purposeUrl} target="_blank" rel="noreferrer">
          About this project ↗
        </a>
      </footer>

      {deleted ? (
        <UndoToast
          count={deleted.length}
          onUndo={() => void restoreDeleted(deleted)}
          onDismiss={dismissUndo}
        />
      ) : null}
    </main>
  )
}

export default App
