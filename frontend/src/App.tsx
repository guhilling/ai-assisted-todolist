import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type TaskState = 'TODO' | 'WORKING' | 'DONE'
type TaskImportance = 'LOW' | 'MEDIUM' | 'HIGH'

type Task = {
  id: number
  description: string
  dueDate: string
  importance: TaskImportance
  state: TaskState
}

type AuthProvider = {
  id: string
  label: string
  available: boolean
  loginUrl: string | null
  issuer: string
}

type AuthProvidersResponse = {
  enabled: boolean
  providers: AuthProvider[]
}

type CurrentUser = {
  email: string
}

const stateOptions: TaskState[] = ['TODO', 'WORKING', 'DONE']
const importanceOptions: TaskImportance[] = ['LOW', 'MEDIUM', 'HIGH']
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''
const authProvidersUrl = `${apiBaseUrl}/api/auth/providers`
const authMeUrl = `${apiBaseUrl}/api/auth/me`
const authLogoutUrl = `${apiBaseUrl}/api/auth/logout`
const tasksBaseUrl = `${apiBaseUrl}/api/tasks`

const jsFetchHeaders = { 'X-Requested-With': 'JavaScript' }

const initialForm = {
  description: '',
  dueDate: '',
  importance: 'MEDIUM' as TaskImportance,
  state: 'TODO' as TaskState,
}

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
        const [meResponse, providersResponse] = await Promise.all([
          fetch(authMeUrl, { credentials: 'include', headers: jsFetchHeaders }),
          fetch(authProvidersUrl),
        ])

        if (providersResponse.ok) {
          setProviders((await providersResponse.json()) as AuthProvidersResponse)
        }

        if (!meResponse.ok) {
          setCurrentUser(null)
          return
        }

        setCurrentUser((await meResponse.json()) as CurrentUser)

        const tasksResponse = await fetch(tasksBaseUrl, { credentials: 'include', headers: jsFetchHeaders })
        if (!tasksResponse.ok) {
          throw new Error('Unable to load tasks from the backend.')
        }
        setTasks((await tasksResponse.json()) as Task[])
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unexpected error while loading data.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const submitTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(tasksBaseUrl, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...jsFetchHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      if (!response.ok) {
        throw new Error('Unable to create task.')
      }

      const createdTask = (await response.json()) as Task
      setTasks((currentTasks) => [...currentTasks, createdTask])
      setForm(initialForm)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unexpected error while saving data.')
    } finally {
      setSaving(false)
    }
  }

  const updateTaskState = async (task: Task, nextState: TaskState) => {
    setError(null)

    try {
      const response = await fetch(`${tasksBaseUrl}/${task.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          ...jsFetchHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...task, state: nextState }),
      })

      if (!response.ok) {
        throw new Error('Unable to update task state.')
      }

      const updatedTask = (await response.json()) as Task
      setTasks((currentTasks) =>
        currentTasks.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      )
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unexpected error while updating data.')
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
                Description
                <input
                  required
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                />
              </label>
              <label>
                Due date
                <input
                  required
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
                />
              </label>
              <label>
                Importance
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
                State
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
                    Update state
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
