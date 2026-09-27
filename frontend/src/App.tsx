/**
 * The app shell: session and board state, and the composition of the pieces that render them.
 *
 * The wire lives in `api.ts` and the due-date words in `dates.ts`, so what remains here is
 * state and the decisions that depend on more than one piece of it.
 */
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  authLogoutUrl,
  deleteTask,
  fetchAuthProviders,
  fetchCurrentUser,
  fetchTasks,
  postTask,
  putTask,
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

  const removeTask = async (task: Task) => {
    const previous = tasks
    setError(null)
    setTasks((current) => current.filter((candidate) => candidate.id !== task.id))

    try {
      await deleteTask(task)
    } catch (deleteError) {
      setTasks(previous)
      setError(toErrorMessage(deleteError, 'Unexpected error while deleting data.'))
    }
  }

  const clearCompleted = async () => {
    setError(null)
    for (const task of completedTasks) {
      await removeTask(task)
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
        <SignedOut providers={providers} />
      </main>
    )
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1 className="app-title">Tasks</h1>
        <div className="app-identity">
          <span className="app-email">{currentUser.email}</span>
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
    </main>
  )
}

export default App
