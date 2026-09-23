import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type TodoState = 'OPEN' | 'PLANNED' | 'WORKING' | 'DONE'

type Todo = {
  id: number
  description: string
  dueDate: string
  state: TodoState
}

type AuthProvider = {
  id: string
  label: string
  configured: boolean
  issuer: string
  redirectUri: string
}

type AuthProvidersResponse = {
  enabled: boolean
  providers: AuthProvider[]
}

const stateOptions: TodoState[] = ['OPEN', 'PLANNED', 'WORKING', 'DONE']
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8080' : '')
const authBaseUrl = `${apiBaseUrl}/api/auth/providers`
const todosBaseUrl = `${apiBaseUrl}/api/todos`

const initialForm = {
  description: '',
  dueDate: '',
  state: 'OPEN' as TodoState,
}

function App() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [providers, setProviders] = useState<AuthProvidersResponse>({ enabled: false, providers: [] })
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const sortedTodos = useMemo(
    () => [...todos].sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
    [todos],
  )

  useEffect(() => {
    const load = async () => {
      try {
        const [todosResponse, authResponse] = await Promise.all([
          fetch(todosBaseUrl),
          fetch(authBaseUrl),
        ])

        if (!todosResponse.ok) {
          throw new Error('Unable to load todos from the backend.')
        }

        if (!authResponse.ok) {
          throw new Error('Unable to load authentication providers.')
        }

        setTodos((await todosResponse.json()) as Todo[])
        setProviders((await authResponse.json()) as AuthProvidersResponse)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Unexpected error while loading data.')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const submitTodo = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(todosBaseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      if (!response.ok) {
        throw new Error('Unable to create todo.')
      }

      const createdTodo = (await response.json()) as Todo
      setTodos((currentTodos) => [...currentTodos, createdTodo])
      setForm(initialForm)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unexpected error while saving data.')
    } finally {
      setSaving(false)
    }
  }

  const updateTodoState = async (todo: Todo, nextState: TodoState) => {
    setError(null)

    try {
      const response = await fetch(`${todosBaseUrl}/${todo.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...todo, state: nextState }),
      })

      if (!response.ok) {
        throw new Error('Unable to update todo state.')
      }

      const updatedTodo = (await response.json()) as Todo
      setTodos((currentTodos) =>
        currentTodos.map((currentTodo) => (currentTodo.id === updatedTodo.id ? updatedTodo : currentTodo)),
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
          <h1>Track work with due dates, state, and OpenID Connect-ready sign-in.</h1>
          <p className="hero-copy">
            The React frontend talks to a Quarkus API backed by PostgreSQL and is prepared for
            Google, Apple, Microsoft Entra ID, and Facebook OpenID Connect configuration.
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
            <h2>Authentication providers</h2>
            <p>
              OIDC can be enabled once client IDs and redirect URIs are provided through backend
              environment variables.
            </p>
          </div>
          <span className={`badge ${providers.enabled ? 'badge--ready' : 'badge--muted'}`}>
            {providers.enabled ? 'OIDC enabled' : 'OIDC setup pending'}
          </span>
        </div>
        <div className="provider-grid">
          {providers.providers.length === 0 ? (
            <p className="empty-state">No authentication providers are configured yet.</p>
          ) : null}
          {providers.providers.map((provider) => (
            <article className="provider-card" key={provider.id}>
              <h3>{provider.label}</h3>
              <p>{provider.issuer}</p>
              <p className="provider-meta">Redirect URI: {provider.redirectUri}</p>
              <button type="button" disabled={!provider.configured}>
                {provider.configured ? `Continue with ${provider.label}` : 'Configure credentials'}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="grid-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Create todo</h2>
              <p>Add a description, due date, and workflow state.</p>
            </div>
          </div>
          <form className="todo-form" onSubmit={submitTodo}>
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
              State
              <select
                value={form.state}
                onChange={(event) =>
                  setForm((current) => ({ ...current, state: event.target.value as TodoState }))
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
              {saving ? 'Saving…' : 'Create todo'}
            </button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Current todos</h2>
              <p>Review and update items in a browser-based workflow board.</p>
            </div>
          </div>
          {loading ? <p>Loading todos…</p> : null}
          {error ? <p className="error-banner">{error}</p> : null}
          <div className="todo-list">
            {sortedTodos.map((todo) => (
              <article className="todo-card" key={todo.id}>
                <div>
                  <p className="todo-state">{todo.state}</p>
                  <h3>{todo.description}</h3>
                  <p>Due {todo.dueDate}</p>
                </div>
                <label>
                  Update state
                  <select
                    value={todo.state}
                    onChange={(event) => updateTodoState(todo, event.target.value as TodoState)}
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
            {!loading && sortedTodos.length === 0 ? <p>No todos yet.</p> : null}
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
