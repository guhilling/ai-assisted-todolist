/**
 * The whole single-page app: server state, the API layer that fetches it, and the markup
 * that renders it.
 *
 * Keeping all three in one module is a deliberate choice for an app this size -- there is
 * one screen, and splitting it would add indirection without removing anything. The API
 * functions below were extracted out of the component so the component holds state and
 * rendering only; they are the seam to split on first if this file grows.
 */
import { useEffect, useMemo, useState } from 'react'
import type { SubmitEvent } from 'react'
import './App.css'

/**
 * Where a task stands in the workflow. Mirrors the backend's TaskState enum; the two must
 * be changed together, since these strings go over the wire verbatim.
 */
type TaskState = 'TODO' | 'WORKING' | 'DONE'
/** How much a task matters. Mirrors the backend's TaskImportance enum. */
type TaskImportance = 'LOW' | 'MEDIUM' | 'HIGH'

/** A task as the backend returns it, matching TaskResource.TaskResponse. */
type Task = {
  id: number
  description: string
  dueDate: string
  importance: TaskImportance
  state: TaskState
}

/**
 * One sign-in card offered by the backend.
 *
 * The frontend hardcodes no provider names: whatever the backend lists is what the user
 * sees. `available` is false and `loginUrl` null when a provider is configured but has no
 * credentials, in which case the card renders disabled rather than disappearing.
 */
type AuthProvider = {
  id: string
  label: string
  available: boolean
  loginUrl: string | null
  issuer: string
}

/**
 * The reply from `/api/auth/providers`. `enabled` says whether authentication is switched
 * on for this deployment at all, which is a different thing from every provider happening
 * to be unconfigured.
 */
type AuthProvidersResponse = {
  enabled: boolean
  providers: AuthProvider[]
}

/** Who is signed in. The backend exposes only the email claim, which is the whole identity. */
type CurrentUser = {
  email: string
}

const stateOptions: TaskState[] = ['TODO', 'WORKING', 'DONE']
const importanceOptions: TaskImportance[] = ['LOW', 'MEDIUM', 'HIGH']
/**
 * Where the API lives. Empty by default, so requests go same-origin and are proxied --
 * by Vite in development, by nginx in a container. Set VITE_API_BASE_URL only to point the
 * app at a backend on a different origin.
 */
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const authProvidersUrl = `${apiBaseUrl}/api/auth/providers`
const authMeUrl = `${apiBaseUrl}/api/auth/me`
const authLogoutUrl = `${apiBaseUrl}/api/auth/logout`
const tasksBaseUrl = `${apiBaseUrl}/api/tasks`

/**
 * Marks a request as coming from script rather than from browser navigation.
 *
 * The backend sets `quarkus.oidc.authentication.java-script-auto-redirect=false`, so a
 * request carrying this header gets a plain 401 instead of a redirect to the identity
 * provider -- which is what lets `fetchCurrentUser` probe the session without navigating
 * the page away.
 */
const jsFetchHeaders = { 'X-Requested-With': 'JavaScript' }

/** A blank new-task form. Also the shape the form resets to after a successful save. */
const initialForm = {
  description: '',
  dueDate: '',
  importance: 'MEDIUM' as TaskImportance,
  state: 'TODO' as TaskState,
}

/** The new-task form's fields, derived from `initialForm` so the two cannot drift apart. */
type TaskForm = typeof initialForm

/** Unwraps a thrown value into something displayable, since a `catch` binding is `unknown`. */
function toErrorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}

/**
 * Parses a successful JSON response, turning any non-2xx status into an error carrying a
 * message the user can actually read.
 */
async function readJson<T>(response: Response, failureMessage: string) {
  if (!response.ok) {
    throw new Error(failureMessage)
  }
  return (await response.json()) as T
}

/**
 * Asks who is signed in, returning null rather than throwing when nobody is.
 *
 * Being signed out is the normal first-visit state, not a failure, so a 401 here is
 * expected and must not surface as an error banner.
 */
async function fetchCurrentUser() {
  const response = await fetch(authMeUrl, { credentials: 'include', headers: jsFetchHeaders })
  return response.ok ? ((await response.json()) as CurrentUser) : null
}

/**
 * Loads the sign-in cards to offer. Returns null on failure so the app can still render
 * its signed-out view instead of breaking outright.
 */
async function fetchAuthProviders() {
  const response = await fetch(authProvidersUrl)
  return response.ok ? ((await response.json()) as AuthProvidersResponse) : null
}

/** Loads the signed-in user's tasks. Only ever their own -- the backend scopes the query. */
async function fetchTasks() {
  const response = await fetch(tasksBaseUrl, { credentials: 'include', headers: jsFetchHeaders })
  return readJson<Task[]>(response, 'Unable to load tasks from the backend.')
}

/** Creates a task and returns it as the backend stored it, including its generated id. */
async function postTask(form: TaskForm) {
  const response = await fetch(tasksBaseUrl, {
    method: 'POST',
    credentials: 'include',
    headers: { ...jsFetchHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  })
  return readJson<Task>(response, 'Unable to create task.')
}

/**
 * Moves a task to another state.
 *
 * The backend's update endpoint replaces the whole task, so the current task is sent back
 * with only `state` changed rather than a partial patch.
 */
async function putTaskState(task: Task, nextState: TaskState) {
  const response = await fetch(`${tasksBaseUrl}/${task.id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { ...jsFetchHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...task, state: nextState }),
  })
  return readJson<Task>(response, 'Unable to update task state.')
}

/**
 * The application shell: loads the session and the board on mount, then renders either the
 * sign-in cards or the task board depending on whether anyone is signed in.
 */
function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [providers, setProviders] = useState<AuthProvidersResponse>({ enabled: false, providers: [] })
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const sortedTasks = useMemo(
    () => [...tasks].sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
    [tasks],
  )

  useEffect(() => {
    const load = async () => {
      try {
        const [user, authProviders] = await Promise.all([fetchCurrentUser(), fetchAuthProviders()])

        if (authProviders) {
          setProviders(authProviders)
        }

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

    void load()
  }, [])

  const submitTask = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const createdTask = await postTask(form)
      setTasks((currentTasks) => [...currentTasks, createdTask])
      setForm(initialForm)
    } catch (saveError) {
      setError(toErrorMessage(saveError, 'Unexpected error while saving data.'))
    } finally {
      setSaving(false)
    }
  }

  const updateTaskState = async (task: Task, nextState: TaskState) => {
    setError(null)

    try {
      const updatedTask = await putTaskState(task, nextState)
      setTasks((currentTasks) =>
        currentTasks.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      )
    } catch (updateError) {
      setError(toErrorMessage(updateError, 'Unexpected error while updating data.'))
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">AI assisted todo monorepo</p>
          <h1>Track work with due dates, importance, state, and Google sign-in.</h1>
          <p className="hero-copy">
            The React frontend talks to a Quarkus API backed by PostgreSQL. The backend itself
            performs the Google sign-in flow and keeps a session with the browser, so the
            frontend never handles a token directly.
          </p>
        </div>
        <dl className="stats">
          <div>
            <dt>Backend</dt>
            <dd>Quarkus + PostgreSQL</dd>
          </div>
          <div>
            <dt>Frontend</dt>
            <dd>React + TypeScript</dd>
          </div>
          <div>
            <dt>Deployment</dt>
            <dd>Docker Compose + Quay images</dd>
          </div>
        </dl>
      </section>

      <section className="panel auth-panel">
        <div className="panel-heading">
          <div>
            <h2>Authentication</h2>
            <p>Sign in with a supported provider to see and manage your own tasks.</p>
          </div>
          {currentUser ? (
            <span className="badge badge--ready">{currentUser.email}</span>
          ) : (
            <span className={`badge ${providers.enabled ? 'badge--ready' : 'badge--muted'}`}>
              {providers.enabled ? 'OIDC enabled' : 'OIDC setup pending'}
            </span>
          )}
        </div>
        {currentUser ? (
          <p>
            Signed in as {currentUser.email}. <a href={authLogoutUrl}>Sign out</a>
          </p>
        ) : (
          <div className="provider-grid">
            <p>Please sign in to continue.</p>
            {providers.providers.length === 0 ? (
              <p className="empty-state">No authentication providers are configured yet.</p>
            ) : null}
            {providers.providers.map((provider) => (
              <article className="provider-card" key={provider.id}>
                <h3>{provider.label}</h3>
                <p>{provider.issuer}</p>
                {provider.available && provider.loginUrl ? (
                  <a className="button-link" href={`${apiBaseUrl}${provider.loginUrl}`}>
                    Continue with {provider.label}
                  </a>
                ) : (
                  <button type="button" disabled>
                    Configure credentials
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {currentUser ? (
        <section className="grid-layout">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Create task</h2>
                <p>Add a description, due date, importance, and workflow state.</p>
              </div>
            </div>
            <form className="todo-form" onSubmit={submitTask}>
              <label>
                <span>Description</span>
                <input
                  required
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
              <label>
                <span>Due date</span>
                <input
                  required
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
                />
              </label>
              <label>
                <span>Importance</span>
                <select
                  value={form.importance}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, importance: event.target.value as TaskImportance }))
                  }
                >
                  {importanceOptions.map((importanceOption) => (
                    <option key={importanceOption} value={importanceOption}>
                      {importanceOption}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>State</span>
                <select
                  value={form.state}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, state: event.target.value as TaskState }))
                  }
                >
                  {stateOptions.map((stateOption) => (
                    <option key={stateOption} value={stateOption}>
                      {stateOption}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Create task'}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Current tasks</h2>
                <p>Review and update items in a browser-based workflow board.</p>
              </div>
            </div>
            {loading ? <p>Loading tasks…</p> : null}
            {error ? <p className="error-banner">{error}</p> : null}
            <div className="todo-list">
              {sortedTasks.map((task) => (
                <article className="todo-card" key={task.id}>
                  <div>
                    <p className="todo-state">{task.state}</p>
                    <h3>{task.description}</h3>
                    <p>Due {task.dueDate}</p>
                    <p>Importance: {task.importance}</p>
                  </div>
                  <label>
                    <span>Update state</span>
                    <select
                      value={task.state}
                      onChange={(event) => updateTaskState(task, event.target.value as TaskState)}
                    >
                      {stateOptions.map((stateOption) => (
                        <option key={stateOption} value={stateOption}>
                          {stateOption}
                        </option>
                      ))}
                    </select>
                  </label>
                </article>
              ))}
              {!loading && sortedTasks.length === 0 ? <p>No tasks yet.</p> : null}
            </div>
          </section>
        </section>
      ) : null}
    </main>
  )
}

export default App
