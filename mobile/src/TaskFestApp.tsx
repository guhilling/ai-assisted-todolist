import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Modal, Pressable, Text, useColorScheme, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { SignedOutError, type BoardTask, type Caller } from './api'
import { isTooOld } from './appVersion'
import { isChangeable } from './board'
import { BoardScreen } from './BoardScreen'
import type { Session } from './session'
import {
  RenewalUnavailableError,
  currentSession,
  sessionFromTokens,
  type Refresh,
  type SessionStore,
  type Tokens,
} from './staySignedIn'
import { stylesFor, type Styles } from './styles'
import { TaskForm, type TaskValues } from './TaskForm'
import { dark, light } from './theme'
import type { Variant } from './variants'
import { catalogues, todayIso, type Language, type Messages, type Task, type TaskInput } from './web'

/** How the app changes tasks on the backend (#271), each as the signed-in user. */
export type TaskChanges = {
  create(caller: Caller, input: TaskInput): Promise<BoardTask>
  update(caller: Caller, task: Task): Promise<BoardTask>
  remove(caller: Caller, task: Task): Promise<void>
  /** Puts a deleted task back; it returns with a new id. */
  restore(caller: Caller, task: Task, today: string): Promise<BoardTask>
}

/** What the app needs from outside itself, handed in so tests can stand in for each. */
export type Dependencies = {
  sessions: SessionStore
  provider: { signIn(): Promise<Tokens | null>; refresh: Refresh }
  fetchTasks(caller: Caller): Promise<BoardTask[]>
  changes: TaskChanges
  /** The oldest app release the backend serves (#268). */
  fetchMinimumAppVersion(): Promise<string>
  /** This build's release: the tag's, or 0.0.0 from a branch. */
  appVersion: string
  now(): number
}

/** How long the start waits to hear which releases the backend serves before carrying on. */
const VERSION_CHECK_MS = 3000

/** The form over the board: adding a task, or editing one. */
type Form = { task?: BoardTask; failure?: string }

/** The promise's value, or null once the time is up -- never a wait without end. */
function withinTime<T>(promise: Promise<T | null>, ms = VERSION_CHECK_MS): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    void promise.then((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}

type State =
  | { kind: 'starting' }
  | { kind: 'signedOut'; notice?: 'sessionExpired' | 'signInFailed' }
  | { kind: 'loading' }
  | { kind: 'board'; tasks: BoardTask[] }
  | { kind: 'failed' }
  | { kind: 'tooOld' }

/**
 * The app, from sign-in to the board (#267, #271), in the user's language, in the website's colours
 * and the website's order.
 *
 * It opens on the board when a session is kept on the phone and still good; otherwise on the
 * variant's sign-in. A board the backend refuses to serve (401) ends the session and says so, as
 * the website does when its cookie has expired, and so does a change it refuses for that reason.
 *
 * Changes behave as on the website: a tick shows at once and is taken back if the backend refuses
 * it; an add or an edit waits for the backend, keeping the form open until it agreed; a delete
 * goes at once, with an offer to undo it.
 */
export function TaskFestApp({
  variant,
  language,
  dependencies,
}: {
  variant: Variant
  language: Language
  dependencies: Dependencies
}) {
  const { sessions, provider, fetchTasks, fetchMinimumAppVersion, appVersion, now, changes } = dependencies
  const messages = catalogues[language]
  const theme = useColorScheme() === 'dark' ? dark : light
  const styles = useMemo(() => stylesFor(theme), [theme])
  const [state, setState] = useState<State>({ kind: 'starting' })
  const [form, setForm] = useState<Form | null>(null)
  const [failure, setFailure] = useState<string>()
  /** What was just deleted and can be put back; the key starts a new countdown for each delete. */
  const [deleted, setDeleted] = useState<{ tasks: BoardTask[]; key: number } | null>(null)
  /** The same, read by undo, which a quick second tap must find already taken. */
  const undoable = useRef<BoardTask[] | null>(null)
  const deletes = useRef(0)
  /** The tasks whose change is on its way: each is sent one change at a time. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set())
  const busyIds = useRef(new Set<number>())
  /** Changes on their way, and whether a form is open: the foreground start waits for neither. */
  const inFlight = useRef(0)
  const formOpen = useRef(false)
  useEffect(() => {
    formOpen.current = form !== null
  }, [form])
  /** The renewal under way, shared, so the refresh token is never spent twice at once. */
  const renewal = useRef<Promise<Session | null> | null>(null)

  const sessionNow = useCallback(() => {
    renewal.current ??= currentSession(sessions, provider.refresh, now()).finally(() => {
      renewal.current = null
    })
    return renewal.current
  }, [now, provider, sessions])

  const showBoard = useCallback(
    async (session: Session) => {
      // A board already shown stays while it loads anew, and with it any form open over it.
      setState((current) => (current.kind === 'board' ? current : { kind: 'loading' }))
      try {
        const tasks = await fetchTasks({ baseUrl: variant.apiBaseUrl, idToken: session.idToken })
        setState({ kind: 'board', tasks })
      } catch (failure) {
        if (failure instanceof SignedOutError) {
          await sessions.clear()
          setState({ kind: 'signedOut', notice: 'sessionExpired' })
        } else {
          setState({ kind: 'failed' })
        }
      }
    },
    [fetchTasks, sessions, variant.apiBaseUrl],
  )

  /** How often the start has been tried: "try again" raises it, and the effect below runs anew. */
  const [attempt, setAttempt] = useState(0)

  // Back in the foreground, the app starts over: the backend may no longer serve this release,
  // and the board may have changed meanwhile. Not while a form is open or a change is on its way,
  // though: the form would lose what was typed, and the board could miss the change.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !formOpen.current && inFlight.current === 0) {
        setAttempt((count) => count + 1)
      }
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    /** From the kept session to the board, or to the sign-in. */
    const start = async () => {
      // Which releases the backend serves, and the kept session, are asked for at once. An app the
      // backend no longer serves says so before anything else; one that cannot find out in time
      // carries on, since a slow or absent network is no reason to lock anyone out.
      const [minimum, outcome] = await Promise.all([
        withinTime(fetchMinimumAppVersion().catch(() => null)),
        sessionNow().then(
          (session) => ({ session }),
          (failure: unknown) => ({ failure }),
        ),
      ])
      if (minimum && isTooOld(appVersion, minimum)) {
        setState({ kind: 'tooOld' })
        return
      }
      let session: Session | null
      if ('session' in outcome) {
        session = outcome.session
      } else {
        const { failure } = outcome
        if (failure instanceof RenewalUnavailableError) {
          // Offline, or the provider unreachable: the session is kept for when it is back.
          setState({ kind: 'failed' })
          return
        }
        // The keychain could not be read -- invalidated, restored from a backup: start afresh.
        console.warn('The kept session could not be read', failure)
        await sessions.clear().catch(() => undefined)
        session = null
      }
      if (session) {
        await showBoard(session)
      } else {
        setState({ kind: 'signedOut' })
      }
    }
    void start()
  }, [appVersion, attempt, fetchMinimumAppVersion, sessionNow, sessions, showBoard])

  const retry = () => {
    setState({ kind: 'starting' })
    setAttempt((count) => count + 1)
  }

  const signIn = async () => {
    try {
      const tokens = await provider.signIn()
      if (!tokens) {
        return
      }
      const session = sessionFromTokens(tokens, now())
      if (!session) {
        throw new Error('The provider issued no ID token the app can use.')
      }
      await sessions.save(session)
      await showBoard(session)
    } catch (failure) {
      // Logged for the device log -- the only trace a failed sign-in on a test device leaves.
      console.warn('Signing in failed', failure)
      setState({ kind: 'signedOut', notice: 'signInFailed' })
    }
  }

  const today = todayIso(new Date(now()))

  /** Applies a change to the board's tasks, if the board is what is shown. */
  const setTasks = (change: (tasks: BoardTask[]) => BoardTask[]) =>
    setState((current) => (current.kind === 'board' ? { ...current, tasks: change(current.tasks) } : current))

  const replace = (task: BoardTask) => setTasks((tasks) => tasks.map((each) => (each.id === task.id ? task : each)))

  /** The session to send a change as, renewed if it is about to run out. */
  const caller = async (): Promise<Caller> => {
    const session = await sessionNow()
    if (!session) {
      throw new SignedOutError()
    }
    return { baseUrl: variant.apiBaseUrl, idToken: session.idToken }
  }

  /**
   * What a failed change leads to: the sign-in, when the session has ended -- that is no failure
   * of the change -- and otherwise the text that says what did not work.
   *
   * @returns the text, or null once the app has signed out
   */
  const failed = async (cause: unknown, text: string): Promise<string | null> => {
    if (cause instanceof SignedOutError) {
      await sessions.clear()
      setForm(null)
      offerUndo(null)
      setFailure(undefined)
      setState({ kind: 'signedOut', notice: 'sessionExpired' })
      return null
    }
    console.warn('A change was not saved', cause)
    return text
  }

  /** Runs a change, counted as on its way until it is done. */
  const sending = async <T,>(change: () => Promise<T>): Promise<T> => {
    inFlight.current += 1
    try {
      return await change()
    } finally {
      inFlight.current -= 1
    }
  }

  /** Marks a task as having a change on its way, or no longer; false when one already was. */
  const markBusy = (task: BoardTask, isBusy: boolean) => {
    if (isBusy && busyIds.current.has(task.id)) {
      return false
    }
    if (isBusy) {
      busyIds.current.add(task.id)
    } else {
      busyIds.current.delete(task.id)
    }
    setBusy(new Set(busyIds.current))
    return true
  }

  /** Offers to put deleted tasks back, each delete with its own countdown; null withdraws it. */
  const offerUndo = (tasks: BoardTask[] | null) => {
    undoable.current = tasks
    deletes.current += 1
    setDeleted(tasks && { tasks, key: deletes.current })
  }

  /** Saves the form; whatever form is open by the time the backend answers is left alone. */
  const save = async (values: TaskValues): Promise<boolean> => {
    const started = form
    const task = started?.task
    setFailure(undefined)
    if (task && !markBusy(task, true)) {
      return false
    }
    try {
      await sending(async () => {
        if (task) {
          replace(await changes.update(await caller(), { ...task, ...values }))
        } else {
          const created = await changes.create(await caller(), { ...values, state: 'TODO' })
          setTasks((tasks) => [...tasks, created])
        }
      })
      setForm((current) => (current === started ? null : current))
      return true
    } catch (cause) {
      const text = await failed(cause, task ? messages.errors.updateTask : messages.errors.createTask)
      if (text) {
        setForm((current) => (current === started && current ? { ...current, failure: text } : current))
      }
      return false
    } finally {
      if (task) {
        markBusy(task, false)
      }
    }
  }

  const toggle = async (task: BoardTask) => {
    if (!markBusy(task, true)) {
      return
    }
    const next: BoardTask = { ...task, state: task.state === 'DONE' ? 'TODO' : 'DONE' }
    setFailure(undefined)
    replace(next)
    try {
      replace(await sending(async () => changes.update(await caller(), next)))
    } catch (cause) {
      replace(task)
      setFailure((await failed(cause, messages.errors.updateTask)) ?? undefined)
    } finally {
      markBusy(task, false)
    }
  }

  /** Deletes the tasks at once, putting back any the backend keeps, and offers to undo the rest. */
  const remove = async (tasks: BoardTask[]) => {
    const gone = new Set(tasks.map((task) => task.id))
    setFailure(undefined)
    setForm(null)
    setTasks((current) => current.filter((task) => !gone.has(task.id)))
    const outcomes = await sending(() =>
      caller().then(
        (session) => Promise.allSettled(tasks.map((task) => changes.remove(session, task))),
        // Without a session, none of them went.
        (cause: unknown) => tasks.map((): PromiseSettledResult<void> => ({ status: 'rejected', reason: cause })),
      ),
    )
    const kept = tasks.filter((_task, index) => outcomes[index].status === 'rejected')
    const removed = tasks.filter((_task, index) => outcomes[index].status === 'fulfilled')
    if (kept.length > 0) {
      setTasks((current) => [...current, ...kept])
      const cause = (outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult).reason
      const text = await failed(cause, messages.errors.deleteTask)
      if (!text) {
        return
      }
      setFailure(text)
    }
    if (removed.length > 0) {
      offerUndo(removed)
    }
  }

  /** Puts back what was deleted, once, and each task that could be; says so if one could not. */
  const undo = async () => {
    const tasks = undoable.current
    if (!tasks) {
      return
    }
    offerUndo(null)
    setFailure(undefined)
    const outcomes = await sending(() =>
      caller().then(
        (session) => Promise.allSettled(tasks.map((task) => changes.restore(session, task, today))),
        (cause: unknown) => tasks.map((): PromiseSettledResult<BoardTask> => ({ status: 'rejected', reason: cause })),
      ),
    )
    const restored = outcomes.flatMap((outcome) => (outcome.status === 'fulfilled' ? [outcome.value] : []))
    setTasks((current) => [...current, ...restored])
    const refused = outcomes.find((outcome) => outcome.status === 'rejected')
    if (refused) {
      setFailure((await failed(refused.reason, messages.failures.restoring)) ?? undefined)
    }
  }

  /** Stable, so that a new render of the board does not restart the undo's countdown. */
  const dismissUndo = useCallback(() => {
    undoable.current = null
    setDeleted(null)
  }, [])

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        {state.kind === 'signedOut' ? (
          <SignedOutScreen
            variant={variant}
            messages={messages}
            styles={styles}
            notice={state.notice}
            onSignIn={signIn}
          />
        ) : state.kind === 'board' ? (
          <>
            <BoardScreen
              tasks={state.tasks}
              today={today}
              language={language}
              messages={messages}
              styles={styles}
              failure={failure}
              deleted={deleted ? { count: deleted.tasks.length, key: deleted.key } : undefined}
              busy={busy}
              onAdd={() => setForm({})}
              onOpen={(task) => setForm({ task })}
              onToggle={(task) => void toggle(task)}
              onClearCompleted={() =>
                void remove(state.tasks.filter((task) => task.state === 'DONE' && isChangeable(task)))
              }
              onUndo={() => void undo()}
              onDismissUndo={dismissUndo}
            />
            <Modal
              visible={form !== null}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => setForm(null)}
            >
              {form ? (
                <TaskForm
                  key={form.task?.id ?? 'new'}
                  task={form.task}
                  today={today}
                  language={language}
                  messages={messages}
                  styles={styles}
                  theme={theme}
                  failure={form.failure}
                  onSave={save}
                  onDelete={form.task ? () => void remove([form.task!]) : undefined}
                  onCancel={() => setForm(null)}
                />
              ) : null}
            </Modal>
          </>
        ) : state.kind === 'tooOld' ? (
          <View style={styles.signedOut}>
            <Text style={styles.notice}>{messages.update.required}</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={retry}>
              <Text style={styles.buttonText}>{messages.board.retry}</Text>
            </Pressable>
          </View>
        ) : state.kind === 'failed' ? (
          <View style={styles.signedOut}>
            <Text style={styles.notice}>{messages.failures.loading}</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={retry}>
              <Text style={styles.buttonText}>{messages.board.retry}</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={theme.accent} accessibilityLabel={messages.board.loading} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

function SignedOutScreen({
  variant,
  messages,
  styles,
  notice,
  onSignIn,
}: {
  variant: Variant
  messages: Messages
  styles: Styles
  notice?: 'sessionExpired' | 'signInFailed'
  onSignIn: () => void
}) {
  return (
    <View style={styles.signedOut}>
      <Text style={styles.title}>TaskFest</Text>
      <Text style={styles.muted}>{messages.signedOut.tagline}</Text>
      {notice ? (
        <Text style={styles.notice}>
          {notice === 'sessionExpired' ? messages.board.sessionExpired : messages.signedOut.failed}
        </Text>
      ) : null}
      {variant.signIn ? (
        <Pressable accessibilityRole="button" style={styles.button} onPress={onSignIn}>
          <Text style={styles.buttonText}>{messages.signedOut.signInWith(variant.signIn.label)}</Text>
        </Pressable>
      ) : (
        <Text style={styles.muted}>{messages.signedOut.notConfigured}</Text>
      )}
    </View>
  )
}
