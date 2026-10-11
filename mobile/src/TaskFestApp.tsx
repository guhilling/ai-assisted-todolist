import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Modal, Pressable, Text, useColorScheme, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { SignedOutError, type BoardTask, type Caller } from './api'
import { AccountScreen } from './AccountScreen'
import { isTooOld } from './appVersion'
import { isChangeable } from './board'
import { BoardScreen } from './BoardScreen'
import type { KeptBoardStore } from './keptBoard'
import { LegalLinks } from './LegalLinks'
import type { ReminderScheduler } from './notifications'
import { remindersFor } from './reminders'
import { emailOf, isInactive, type Session } from './session'
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
import { catalogues, localeOf, todayIso, type Language, type Messages, type Task, type TaskInput } from './web'

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
  /** Deletes the signed-in user's account with everything in it (#275). */
  deleteAccount(caller: Caller): Promise<void>
  /** The last board loaded, kept on the phone to be read without a connection (#272). */
  keptBoard: KeptBoardStore
  /** The due-day reminders on the phone, and the permission they need (#273). */
  reminders: ReminderScheduler
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

/** A change asked for while the board shown may not be current: refused, not sent (#272). */
class KeptBoardShownError extends Error {
  constructor() {
    super('The board shown may not be current.')
    this.name = 'KeptBoardShownError'
  }
}

/** Why the sign-in is shown, when there is something to say about it. */
type SignedOutNotice = 'sessionExpired' | 'signInFailed' | 'accountDeleted'

/** The account sheet over the board: whether a delete is on its way, or what went wrong with the last. */
type Account = { deleting?: boolean; failure?: string }

type State =
  | { kind: 'starting' }
  | { kind: 'signedOut'; notice?: SignedOutNotice }
  | { kind: 'loading' }
  | {
      kind: 'board'
      tasks: BoardTask[]
      email: string | null
      /** When the board shown was loaded, in milliseconds since the epoch. */
      loadedAt: number
      /**
       * Set while it may not be current (#272): the board kept on the phone, shown while the
       * current one is `loading`, or after a load `failed`. Nothing on it can be changed then.
       */
      kept?: 'loading' | 'failed'
    }
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
 *
 * Signing out forgets the session on the phone and nothing more, as the website's sign-out leaves
 * the provider's own session alone (#275): signing in again may not ask for a password.
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
  const {
    sessions,
    provider,
    fetchTasks,
    fetchMinimumAppVersion,
    appVersion,
    now,
    changes,
    deleteAccount,
    keptBoard,
    reminders,
  } = dependencies
  const messages = catalogues[language]
  const theme = useColorScheme() === 'dark' ? dark : light
  const styles = useMemo(() => stylesFor(theme), [theme])
  const [state, setState] = useState<State>({ kind: 'starting' })
  const [form, setForm] = useState<Form | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [failure, setFailure] = useState<string>()
  /** Whether a change was refused because the board shown may not be current (#272), until it is. */
  const [refused, setRefused] = useState(false)
  /** Whether the reminders may be offered (#273): they may be asked for, and the offer was not answered. */
  const [offerReminders, setOfferReminders] = useState(false)
  /** The state as of the last render, for the changes that check it once their await is over. */
  const shown = useRef<State>(state)
  useEffect(() => {
    shown.current = state
  }, [state])
  /**
   * The backend's view of the board -- what it last sent or agreed to, and for whom -- which is
   * what the phone keeps (#272): never a tick it has not answered yet. Gone with the sign-out.
   */
  const agreed = useRef<{ account: string; loadedAt: number; tasks: Map<number, BoardTask> } | null>(null)
  /** What was just deleted and can be put back; the key starts a new countdown for each delete. */
  const [deleted, setDeleted] = useState<{ tasks: BoardTask[]; key: number } | null>(null)
  /** The same, read by undo, which a quick second tap must find already taken. */
  const undoable = useRef<BoardTask[] | null>(null)
  const deletes = useRef(0)
  /** The tasks whose change is on its way: each is sent one change at a time. */
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set())
  const busyIds = useRef(new Set<number>())
  /** Changes on their way, and whether a form or the account sheet is open: the foreground start waits for neither. */
  const inFlight = useRef(0)
  const sheetOpen = useRef(false)
  useEffect(() => {
    sheetOpen.current = form !== null || account !== null
  }, [form, account])
  /** A sign-in in the browser: coming back from it is a return to the foreground, not a reason to start over. */
  const signingIn = useRef(false)
  /** Raised by every sign-out, so a start or a load begun before one does not sign back in after it. */
  const signOuts = useRef(0)
  /** The renewal under way, shared, so the refresh token is never spent twice at once. */
  const renewal = useRef<Promise<Session | null> | null>(null)

  const sessionNow = useCallback(() => {
    renewal.current ??= currentSession(sessions, provider.refresh, now()).finally(() => {
      renewal.current = null
    })
    return renewal.current
  }, [now, provider, sessions])

  /**
   * Forgets the session on the phone and everything shown for it, and goes back to the sign-in.
   * The one way out: whatever the app keeps for a signed-in user goes here.
   *
   * A renewal under way would save its session after the keychain was cleared, so it is waited for
   * first; and a start or a load begun before the sign-out finds it counted and gives up.
   */
  const signOut = useCallback(
    async (notice?: SignedOutNotice) => {
      signOuts.current += 1
      // Before anything is awaited: a change answered meanwhile must not keep the board again.
      agreed.current = null
      await renewal.current?.catch(() => undefined)
      await sessions.clear().catch((failure: unknown) => {
        // The screen signs out regardless; the next start finds the session again, at worst.
        console.warn('The kept session could not be forgotten', failure)
      })
      await keptBoard.clear().catch((failure: unknown) => {
        // Never shown to anyone else regardless: it names its account.
        console.warn('The kept board could not be forgotten', failure)
      })
      // No reminder outlives the session it was scheduled for.
      await reminders.replace([]).catch((failure: unknown) => {
        console.warn('The reminders could not be cleared', failure)
      })
      setOfferReminders(false)
      setForm(null)
      setAccount(null)
      undoable.current = null
      setDeleted(null)
      setFailure(undefined)
      setRefused(false)
      setState({ kind: 'signedOut', notice })
    },
    [keptBoard, reminders, sessions],
  )

  /** Keeps the backend's view of the board on the phone, after applying what it just agreed to. */
  const keep = useCallback(
    (change?: (tasks: Map<number, BoardTask>) => void) => {
      const view = agreed.current
      if (!view) {
        return
      }
      change?.(view.tasks)
      // "As of" the load: every task the backend has not answered for since is that old.
      const tasks = [...view.tasks.values()]
      keptBoard.save({ account: view.account, savedAt: view.loadedAt, tasks }).catch((failure: unknown) => {
        console.warn('The board could not be kept', failure)
      })
      // The reminders follow the same view, so a task completed or moved never reminds (#273).
      reminders.replace(remindersFor(tasks, now(), messages)).catch((failure: unknown) => {
        console.warn('The reminders could not be scheduled', failure)
      })
    },
    [keptBoard, messages, now, reminders],
  )

  /**
   * The board kept on the phone, shown at once while the current one loads -- if the kept session
   * is its account's, and still good. A board already shown stays.
   */
  const showKept = useCallback(async () => {
    // Only at a fresh start: back in the foreground, the board shown is newer than the kept one.
    if (shown.current.kind !== 'starting') {
      return
    }
    const [board, stored] = await Promise.all([
      keptBoard.load().catch(() => null),
      sessions.load().catch(() => null),
    ])
    if (!board || !stored || isInactive(stored, now()) || emailOf(stored.idToken) !== board.account) {
      return
    }
    setState((current) =>
      current.kind === 'starting'
        ? { kind: 'board', tasks: board.tasks, email: board.account, loadedAt: board.savedAt, kept: 'loading' }
        : current,
    )
  }, [keptBoard, now, sessions])

  /** Offers the reminders while they may be asked for and the offer has not been answered (#273). */
  const offerIfAsked = useCallback(async () => {
    const started = signOuts.current
    let offer: boolean
    try {
      offer = (await reminders.permission()) === 'undetermined' && !(await reminders.answered())
    } catch {
      offer = false
    }
    // An answer arriving after a sign-out is the old session's, and the sign-out has reset it.
    if (signOuts.current === started) {
      setOfferReminders(offer)
    }
  }, [reminders])

  /** A load that did not work: a board shown stays, marked as possibly out of date. */
  const loadFailed = useCallback(
    () => setState((current) => (current.kind === 'board' ? { ...current, kept: 'failed' } : { kind: 'failed' })),
    [],
  )

  const showBoard = useCallback(
    async (session: Session) => {
      const started = signOuts.current
      // A board already shown stays while it loads anew, and with it any form open over it.
      setState((current) => (current.kind === 'board' ? current : { kind: 'loading' }))
      try {
        const tasks = await fetchTasks({ baseUrl: variant.apiBaseUrl, idToken: session.idToken })
        if (signOuts.current === started) {
          const email = emailOf(session.idToken)
          const loadedAt = now()
          setState({ kind: 'board', tasks, email, loadedAt })
          // A change refused because the board was not current is moot once it is.
          setRefused(false)
          agreed.current = email ? { account: email, loadedAt, tasks: new Map(tasks.map((task) => [task.id, task])) } : null
          keep()
          void offerIfAsked()
        }
      } catch (failure) {
        if (signOuts.current !== started) {
          return
        }
        if (failure instanceof SignedOutError) {
          await signOut('sessionExpired')
        } else {
          loadFailed()
        }
      }
    },
    [fetchTasks, keep, loadFailed, now, offerIfAsked, signOut, variant.apiBaseUrl],
  )

  /** How often the start has been tried: "try again" raises it, and the effect below runs anew. */
  const [attempt, setAttempt] = useState(0)

  // Back in the foreground, the app starts over: the backend may no longer serve this release,
  // and the board may have changed meanwhile. Not while a form or the account sheet is open or a
  // change is on its way, though: the sheet would lose what was typed -- and the account sheet's
  // own legal links leave the app -- and the board could miss the change. Nor while signing in:
  // the browser coming back is a return to the foreground, and starting over then finds no session
  // yet and could forget the one the sign-in is about to save.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !sheetOpen.current && !signingIn.current && inFlight.current === 0) {
        // A board that could not be loaded says it is being loaded again, as "Try again" does.
        setState((current) => (current.kind === 'board' && current.kept ? { ...current, kept: 'loading' } : current))
        setAttempt((count) => count + 1)
      }
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    /** From the kept session to the board, or to the sign-in. */
    const start = async () => {
      const started = signOuts.current
      // Which releases the backend serves, and the kept session, are asked for at once, and the
      // kept board shown meanwhile. An app the backend no longer serves says so before anything
      // else; one that cannot find out in time carries on, since a slow or absent network is no
      // reason to lock anyone out.
      const [, minimum, outcome] = await Promise.all([
        showKept(),
        withinTime(fetchMinimumAppVersion().catch(() => null)),
        sessionNow().then(
          (session) => ({ session }),
          (failure: unknown) => ({ failure }),
        ),
      ])
      if (signOuts.current !== started) {
        return
      }
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
          loadFailed()
          return
        }
        // The keychain could not be read -- invalidated, restored from a backup: start afresh.
        console.warn('The kept session could not be read', failure)
        await signOut()
        return
      }
      if (session) {
        await showBoard(session)
      } else {
        // The session ran out unused: its board and its reminders go with it.
        await keptBoard.clear().catch(() => undefined)
        await reminders.replace([]).catch(() => undefined)
        // Already at the sign-in, it stays as it is, with whatever it says -- "account deleted", say.
        setState((current) => (current.kind === 'signedOut' ? current : { kind: 'signedOut' }))
      }
    }
    void start()
  }, [appVersion, attempt, fetchMinimumAppVersion, keptBoard, loadFailed, reminders, sessionNow, showBoard, showKept, signOut])

  const retry = () => {
    setState({ kind: 'starting' })
    setAttempt((count) => count + 1)
  }

  /** Asks the platform for the reminders' permission, and schedules them once it is given. */
  const turnOnReminders = async () => {
    setOfferReminders(false)
    if (await reminders.ask().catch(() => false)) {
      keep()
    }
  }

  /** "Not now": the offer is not made again. */
  const declineReminders = () => {
    setOfferReminders(false)
    reminders.decline().catch((failure: unknown) => console.warn('The declined offer could not be kept', failure))
  }

  /** Loads the board again, keeping the one shown until the new one is there. */
  const reload = () => {
    setState((current) => (current.kind === 'board' ? { ...current, kept: 'loading' } : current))
    setAttempt((count) => count + 1)
  }

  /**
   * Whether the board shown may not be current, which no change is made to (#272): an update
   * replaces the whole task, so one made to an old copy would overwrite whatever changed since.
   * Says so, and the change is not sent -- nor kept to send later.
   */
  const refusedWhileKept = () => {
    if (state.kind !== 'board' || !state.kept) {
      return false
    }
    setRefused(true)
    return true
  }

  const signIn = async () => {
    signingIn.current = true
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
    } finally {
      signingIn.current = false
    }
  }

  const today = todayIso(new Date(now()))

  /** Whether the board has anything to be reminded of: the offer explains itself by it (#273). */
  const remindable = useMemo(
    () => state.kind === 'board' && remindersFor(state.tasks, now(), messages).length > 0,
    [messages, now, state],
  )

  /** Applies a change to the board's tasks, if the board is what is shown. */
  const setTasks = (change: (tasks: BoardTask[]) => BoardTask[]) =>
    setState((current) => (current.kind === 'board' ? { ...current, tasks: change(current.tasks) } : current))

  const replace = (task: BoardTask) => setTasks((tasks) => tasks.map((each) => (each.id === task.id ? task : each)))

  /**
   * The session to send a change to the board as -- the one door every such change goes through,
   * so none is sent while the board shown may not be current (#272).
   */
  const caller = async (): Promise<Caller> => {
    const board = shown.current
    if (board.kind === 'board' && board.kept) {
      throw new KeptBoardShownError()
    }
    return signedInCaller()
  }

  /**
   * The session to send a request as, renewed if it is about to run out. Deleting the account goes
   * this way: it does not depend on how current the board is.
   */
  const signedInCaller = async (): Promise<Caller> => {
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
   * @returns the text, or null once the app has signed out or said why nothing could be changed
   */
  const failed = async (cause: unknown, text: string): Promise<string | null> => {
    if (cause instanceof SignedOutError) {
      await signOut('sessionExpired')
      return null
    }
    if (cause instanceof KeptBoardShownError) {
      setRefused(true)
      return null
    }
    console.warn('A change was not saved', cause)
    return text
  }

  /** Deletes the account, then signs out; says why on the sheet when the backend refused. */
  const removeAccount = async (): Promise<boolean> => {
    // Nothing else is offered until the backend answers: a sign-out and a new sign-in meanwhile
    // would leave this answer to sign out a session that never asked for it.
    setAccount({ deleting: true })
    try {
      await sending(async () => deleteAccount(await signedInCaller()))
    } catch (cause) {
      const text = await failed(cause, messages.errors.deleteAccount)
      // Whatever the failure, the sheet is offered again -- only one the session's end closed
      // meanwhile stays closed.
      setAccount((current) => current && { failure: text ?? undefined })
      return false
    }
    await signOut('accountDeleted')
    return true
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
          const saved = await changes.update(await caller(), { ...task, ...values })
          replace(saved)
          keep((kept) => kept.set(saved.id, saved))
        } else {
          const created = await changes.create(await caller(), { ...values, state: 'TODO' })
          setTasks((tasks) => [...tasks, created])
          keep((kept) => kept.set(created.id, created))
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
    if (refusedWhileKept() || !markBusy(task, true)) {
      return
    }
    const next: BoardTask = { ...task, state: task.state === 'DONE' ? 'TODO' : 'DONE' }
    setFailure(undefined)
    replace(next)
    try {
      const saved = await sending(async () => changes.update(await caller(), next))
      replace(saved)
      keep((kept) => kept.set(saved.id, saved))
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
      keep((kept) => removed.forEach((task) => kept.delete(task.id)))
      offerUndo(removed)
    }
  }

  /** Puts back what was deleted, once, and each task that could be; says so if one could not. */
  const undo = async () => {
    const tasks = undoable.current
    // Refused before the offer is withdrawn: it stands for the rest of its time (#272).
    if (!tasks || refusedWhileKept()) {
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
    keep((kept) => restored.forEach((task) => kept.set(task.id, task)))
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
            language={language}
            appVersion={appVersion}
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
              failure={
                refused && state.kept
                  ? state.kept === 'loading'
                    ? messages.offline.wait
                    : messages.offline.readOnly
                  : failure
              }
              deleted={deleted ? { count: deleted.tasks.length, key: deleted.key } : undefined}
              busy={busy}
              onAdd={() => refusedWhileKept() || setForm({})}
              onOpen={(task) => refusedWhileKept() || setForm({ task })}
              onToggle={(task) => void toggle(task)}
              onClearCompleted={() =>
                refusedWhileKept() ||
                void remove(state.tasks.filter((task) => task.state === 'DONE' && isChangeable(task)))
              }
              onUndo={() => void undo()}
              onDismissUndo={dismissUndo}
              onAccount={() => setAccount({})}
              kept={
                state.kept === 'failed'
                  ? { failed: true, since: describeTime(state.loadedAt, language) }
                  : state.kept
                    ? { failed: false }
                    : undefined
              }
              onRetry={reload}
              offer={
                offerReminders && !state.kept && remindable
                  ? { onTurnOn: () => void turnOnReminders(), onNotNow: declineReminders }
                  : undefined
              }
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
            <Modal
              testID="account-sheet"
              visible={account !== null}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => setAccount((current) => (current?.deleting ? current : null))}
            >
              <AccountScreen
                email={state.email}
                language={language}
                messages={messages}
                styles={styles}
                theme={theme}
                appVersion={appVersion}
                failure={account?.failure}
                deleting={account?.deleting ?? false}
                onSignOut={() => void signOut()}
                onDelete={removeAccount}
                onDone={() => setAccount(null)}
              />
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

/** The words for each reason the sign-in is shown. */
function noticeText(notice: SignedOutNotice, messages: Messages) {
  switch (notice) {
    case 'sessionExpired':
      return messages.board.sessionExpired
    case 'signInFailed':
      return messages.signedOut.failed
    case 'accountDeleted':
      return messages.account.deleted
  }
}

function SignedOutScreen({
  variant,
  language,
  appVersion,
  messages,
  styles,
  notice,
  onSignIn,
}: {
  variant: Variant
  language: Language
  appVersion: string
  messages: Messages
  styles: Styles
  notice?: SignedOutNotice
  onSignIn: () => void
}) {
  return (
    <View style={styles.board}>
      <View style={styles.signedOut}>
        <Text style={styles.title}>TaskFest</Text>
        <Text style={styles.muted}>{messages.signedOut.tagline}</Text>
        {notice ? (
          <Text style={notice === 'accountDeleted' ? styles.muted : styles.notice}>{noticeText(notice, messages)}</Text>
        ) : null}
        {variant.signIn ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={onSignIn}>
            <Text style={styles.buttonText}>{messages.signedOut.signInWith(variant.signIn.label)}</Text>
          </Pressable>
        ) : (
          <Text style={styles.muted}>{messages.signedOut.notConfigured}</Text>
        )}
      </View>
      <LegalLinks language={language} messages={messages} styles={styles} appVersion={appVersion} />
    </View>
  )
}

/** A moment as the user's language writes it: "10 Oct, 08:00". */
function describeTime(epochMs: number, language: Language) {
  return new Date(epochMs).toLocaleString(localeOf(language), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
