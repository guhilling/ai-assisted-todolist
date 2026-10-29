import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Image, Linking, Modal, Pressable, Text, useColorScheme, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AttachmentRefusedError, RequestFailedError, SignedOutError, TimedOutError, VERSION_CHECK_MS, type BoardTask, type Caller } from './api'
import { FileViewer } from './Attachments'
import { isImage, isLink } from './files'
import type { SharedDraft, SharedLink } from './incoming'
import { CameraRefusedError, type PickSource } from './pick'
import type { PickedFile } from './upload'
import { AccountScreen } from './AccountScreen'
import { isTooOld } from './appVersion'
import { isChangeable } from './board'
import type { GoogleProvider } from './google'
import { BoardScreen } from './BoardScreen'
import type { KeptBoardStore } from './keptBoard'
import { noPreviews, type PreviewStore } from './previews'
import { AboutLink, LegalLinks } from './LegalLinks'
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
import {
  attachmentLimits,
  catalogues,
  checkFile,
  googleSignInButton,
  isWebAddress,
  localeOf,
  todayIso,
  type Attachment,
  type Language,
  type Messages,
  type Task,
  type TaskInput,
} from './web'

/** How the app changes tasks on the backend (#271), each as the signed-in user. */
export type TaskChanges = {
  create(caller: Caller, input: TaskInput): Promise<BoardTask>
  update(caller: Caller, task: Task): Promise<BoardTask>
  remove(caller: Caller, task: Task): Promise<void>
  /** Puts a deleted task back; it returns with a new id. */
  restore(caller: Caller, task: Task, today: string): Promise<BoardTask>
  /**
   * Draft tasks (#381), which the add form's files upload to while it is open. Left out, or
   * refused by a backend from before them, the files wait for Add.
   */
  drafts?: {
    start(caller: Caller): Promise<number>
    add(caller: Caller, draftId: number, input: TaskInput): Promise<BoardTask>
    discard(caller: Caller, draftId: number): Promise<void>
  }
}

/** What the app needs from outside itself, handed in so tests can stand in for each. */
export type Dependencies = {
  sessions: SessionStore
  provider: { signIn(): Promise<Tokens | null>; refresh: Refresh }
  /** Google's sign-in (#280), where the variant has it. */
  google?: GoogleProvider
  fetchTasks(caller: Caller): Promise<BoardTask[]>
  changes: TaskChanges
  /** A task's files (#274): links that show them, signed for a limited time, and removing one. */
  attachments?: {
    link(caller: Caller, taskId: Task['id'], attachmentId: Attachment['id'], thumbnail: boolean): Promise<string>
    remove(caller: Caller, taskId: Task['id'], attachmentId: Attachment['id']): Promise<void>
    /** Attaches a picked file to a task, reporting the upload's progress as a fraction (#274). */
    upload?(caller: Caller, taskId: Task['id'], file: PickedFile, onProgress: (fraction: number) => void): Promise<Attachment>
    /** Adds a link a share brought to a task (#414). */
    addLink?(caller: Caller, taskId: Task['id'], link: SharedLink): Promise<Attachment>
  }
  /** Picks a file to attach (#274); null when the user turned back. */
  pickFile?(source: PickSource): Promise<PickedFile | null>
  /** Files other than images, opened in the phone's own viewer, and the copies that takes forgotten (#274). */
  documents?: {
    open(url: string, fileName: string, contentType: string): Promise<void>
    forget(): Promise<void>
  }
  /** Deletes the signed-in user's account with everything in it (#275). */
  deleteAccount(caller: Caller): Promise<void>
  /** The last board loaded, kept on the phone to be read without a connection (#272). */
  keptBoard: KeptBoardStore
  /** The files' previews, kept on the phone to be shown without a connection too (#397); none, and each is loaded every time. */
  previews?: PreviewStore
  /** The due-day reminders on the phone, and the permission they need (#273). */
  reminders: ReminderScheduler
  /** Whether the board's colours were explained on this phone already (#335); none, and they never are. */
  legend?: { seen(): Promise<boolean>; dismiss(): Promise<void> }
  /**
   * What another app shared (#355): taken once, as a task to add, and its copies of the files
   * forgotten once that is done with. None, and the app is offered nothing.
   */
  incoming?: { take(): Promise<SharedDraft | null>; forget(files: PickedFile[]): Promise<void> }
  /** The oldest app release the backend serves (#268). */
  fetchMinimumAppVersion(): Promise<string>
  /** This build's release: the tag's, or 0.0.0 from a branch. */
  appVersion: string
  now(): number
}

/** How long a link to a file is used again: minutes, where the backend signs it for an hour. */
const LINK_KEPT_MS = 5 * 60 * 1000

/** The form over the board: adding a task, or editing one. */
type Form = {
  task?: BoardTask
  failure?: string
  /** Files picked while adding a task, attached once it exists (#274). */
  pending?: PickedFile[]
  /** The description a share brought, to add a task with (#355). */
  description?: string
  /** The files a share brought, all of them, forgotten once the form closes (#355). */
  shared?: PickedFile[]
  /** The links a share brought, added once the task exists (#414). */
  links?: SharedLink[]
  /**
   * Which share this is, counted: the form's key, so that a share opened straight after another
   * one closes is a new form, not the last one's with its text (#355).
   */
  share?: number
  /** Which add form this is -- `add-<n>`, or `share-<n>` for a share's -- what its draft belongs to (#381). */
  opened?: string
}

/**
 * The draft task an add form's files upload to while it is open (#381), kept beside the form rather
 * than in it: nothing here is shown, and an answer may arrive after the form has closed.
 */
type DraftUploads = {
  /** The draft, once started. */
  id?: number
  /** Whether the backend takes no drafts, or could not start one: the files then wait for Add. */
  unavailable?: boolean
  /** The files already on the draft. */
  uploaded: Map<PickedFile, Attachment>
  /** Whether Add made it a task, so closing the form leaves it. */
  added?: boolean
}

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
    google,
    fetchTasks,
    fetchMinimumAppVersion,
    appVersion,
    now,
    changes,
    attachments: files,
    pickFile,
    documents,
    deleteAccount,
    keptBoard,
    previews = noPreviews,
    reminders,
    legend,
    incoming,
  } = dependencies
  const messages = catalogues[language]
  const darkMode = useColorScheme() === 'dark'
  const theme = darkMode ? dark : light
  const styles = useMemo(() => stylesFor(theme), [theme])
  const [state, setState] = useState<State>({ kind: 'starting' })
  const [form, setForm] = useState<Form | null>(null)
  const [account, setAccount] = useState<Account | null>(null)
  const [failure, setFailure] = useState<string>()
  /** The image opened from a task, shown over everything (#274). */
  const [viewing, setViewing] = useState<{ url: string; fileName: string } | null>(null)
  /** What other apps shared, oldest first, each waiting until the board can take it (#355). */
  const [shares, setShares] = useState<{ draft: SharedDraft; number: number }[]>([])
  /**
   * The links to files asked for, each kept for a few minutes -- well inside the backend's signing
   * time, and by the phone's clock alone, so a phone whose clock is off does not keep a dead link --
   * so a preview does not ask on every render, and two asking at once share one request.
   */
  const links = useRef(new Map<string, { link: Promise<string>; until: number }>())
  /** The file uploading, to which task -- or the one being added -- and how far it has got (#274). */
  const [uploading, setUploading] = useState<{ taskId: Task['id'] | 'new'; name: string; fraction: number } | null>(null)
  /** The form open now, for an answer that arrives after it may have closed. */
  const formNow = useRef<Form | null>(null)
  useEffect(() => {
    formNow.current = form
  }, [form])
  /** How many add forms the Add button has opened: each one's number, for its draft (#381). */
  const addsOpened = useRef(0)
  /** The draft of each add form that has one, by the form's number (#381). */
  const draftUploads = useRef(new Map<string, DraftUploads>())
  /** Whether a file is on its way to a draft; one at a time, as the editor's uploads go. */
  const draftBusy = useRef(false)
  /** Raised when a draft's upload ends, so the next file waiting starts. */
  const [, setDraftTurn] = useState(0)
  /** Whether a draft is being started or a file put on it: Add waits, as it does for an upload. */
  const [draftWorking, setDraftWorking] = useState(false)
  /** Whether a file is being opened: a second tap meanwhile opens nothing more. */
  const opening = useRef(false)
  /** Whether a change was refused because the board shown may not be current (#272), until it is. */
  const [refused, setRefused] = useState(false)
  /** Whether the reminders may be offered (#273): they may be asked for, and the offer was not answered. */
  const [offerReminders, setOfferReminders] = useState(false)
  /** Whether the board's colours still need explaining (#335): until dismissed once on this phone. */
  const [explainColours, setExplainColours] = useState(false)
  useEffect(() => {
    let current = true
    legend
      ?.seen()
      .then((seen) => current && setExplainColours(!seen))
      .catch((failure: unknown) => console.warn('Whether the colours were explained could not be read', failure))
    return () => {
      current = false
    }
  }, [legend])
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
  /**
   * Google's renewal, which counts as signing in: on Android, Credential Manager may show its
   * account sheet, and the app coming back from it is no reason to start over.
   */
  const renewWithGoogle = useCallback(
    (google: GoogleProvider) => async () => {
      signingIn.current = true
      try {
        return await google.renew()
      } finally {
        signingIn.current = false
      }
    },
    [],
  )
  /** Raised by every sign-out, so a start or a load begun before one does not sign back in after it. */
  const signOuts = useRef(0)
  /** The renewal under way, shared, so the refresh token is never spent twice at once. */
  const renewal = useRef<Promise<Session | null> | null>(null)

  const sessionNow = useCallback(() => {
    renewal.current ??= currentSession(sessions, provider.refresh, now(), google && renewWithGoogle(google)).finally(() => {
      renewal.current = null
    })
    return renewal.current
  }, [google, now, provider, renewWithGoogle, sessions])

  /**
   * Forgets every file of the session: the image open, the links asked for, and the copies opened
   * in the phone's viewer -- none of it is for whoever signs in next.
   */
  const forgetFiles = useCallback(() => {
    setViewing(null)
    links.current.clear()
    documents?.forget().catch((failure: unknown) => {
      console.warn('The opened files could not be forgotten', failure)
    })
  }, [documents])

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
      const kept = await sessions.load().catch(() => null)
      await sessions.clear().catch((failure: unknown) => {
        // The screen signs out regardless; the next start finds the session again, at worst.
        console.warn('The kept session could not be forgotten', failure)
      })
      // Google's SDK remembers the account too; forgotten, the next sign-in asks which one. Not
      // waited for: a native call that never answers must not keep the board on the screen.
      if (kept?.via === 'google') {
        google?.signOut().catch((failure: unknown) => {
          console.warn('Google could not be signed out of', failure)
        })
      }
      await keptBoard.clear().catch((failure: unknown) => {
        // Never shown to anyone else regardless: it names its account.
        console.warn('The kept board could not be forgotten', failure)
      })
      await previews.clear().catch((failure: unknown) => {
        console.warn('The kept previews could not be forgotten', failure)
      })
      // No reminder outlives the session it was scheduled for.
      await reminders.replace([]).catch((failure: unknown) => {
        console.warn('The reminders could not be cleared', failure)
      })
      forgetFiles()
      setOfferReminders(false)
      setForm(null)
      setAccount(null)
      undoable.current = null
      setDeleted(null)
      setFailure(undefined)
      setRefused(false)
      setState({ kind: 'signedOut', notice })
    },
    [forgetFiles, google, keptBoard, previews, reminders, sessions],
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
      // Its previews with it: those of files no longer on it go (#397).
      previews.retain(tasks.flatMap((task) => (task.attachments ?? []).map((attachment) => attachment.id))).catch((failure: unknown) => {
        console.warn('The kept previews could not be tidied', failure)
      })
      // The reminders follow the same view, so a task completed or moved never reminds (#273).
      reminders.replace(remindersFor(tasks, now(), messages)).catch((failure: unknown) => {
        console.warn('The reminders could not be scheduled', failure)
      })
    },
    [keptBoard, messages, now, previews, reminders],
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

  /** Takes what another app shared, if anything, to show once the board can take it (#355). */
  const takeShare = useRef<() => void>(() => undefined)
  const sharesTaken = useRef(0)
  useEffect(() => {
    takeShare.current = () => {
      incoming
        ?.take()
        .then((draft) => draft && setShares((waiting) => [...waiting, { draft, number: ++sharesTaken.current }]))
        .catch((failure: unknown) => console.warn('What was shared could not be read', failure))
    }
    // At the start: a share may be what started the app.
    takeShare.current()
  }, [incoming])

  /**
   * The copies of a share's files go once its form is closed -- added, cancelled, or closed by a
   * sign-out -- and none of them is uploading any more: a form closed while its task is added does
   * not take the files from under the upload.
   */
  const sharesShown = useRef(new Set<PickedFile[]>())
  const sharesSaving = useRef(new Set<PickedFile[]>())
  const forgetShare = useCallback(
    (files: PickedFile[]) => {
      if (sharesSaving.current.has(files) || !sharesShown.current.delete(files)) {
        return
      }
      incoming?.forget(files).catch((failure: unknown) => console.warn('The shared files could not be forgotten', failure))
    },
    [incoming],
  )
  useEffect(() => {
    for (const files of sharesShown.current) {
      if (files !== form?.shared) {
        forgetShare(files)
      }
    }
    if (form?.shared) {
      sharesShown.current.add(form.shared)
    }
  }, [form, forgetShare])

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
      // A share brings the app to the foreground; it waits for the board below, wherever the app is.
      if (next === 'active') {
        takeShare.current()
      }
      // Not while a file is open in another app, or being opened: coming back from it is no reason.
      if (next === 'active' && !sheetOpen.current && !signingIn.current && !opening.current && inFlight.current === 0) {
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
        // The session ran out unused: its board, its files and its reminders go with it.
        forgetFiles()
        await keptBoard.clear().catch(() => undefined)
        await previews.clear().catch(() => undefined)
        await reminders.replace([]).catch(() => undefined)
        // Already at the sign-in, it stays as it is, with whatever it says -- "account deleted", say.
        setState((current) => (current.kind === 'signedOut' ? current : { kind: 'signedOut' }))
      }
    }
    void start()
  }, [appVersion, attempt, fetchMinimumAppVersion, forgetFiles, keptBoard, loadFailed, previews, reminders, sessionNow, showBoard, showKept, signOut])

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

  /** "Got it": the colours are not explained again on this phone (#335). */
  const dismissLegend = () => {
    setExplainColours(false)
    legend?.dismiss().catch((failure: unknown) => console.warn('The explained colours could not be remembered', failure))
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

  /** Signs in with the variant's provider, or with Google: a Google session says so, to be renewed by Google. */
  const signIn = async (withGoogle = false) => {
    // One at a time: a second tap while the first sign-in is still under way would start another.
    if (signingIn.current) {
      return
    }
    signingIn.current = true
    try {
      const tokens = withGoogle && google ? await google.signIn() : await provider.signIn()
      if (!tokens) {
        return
      }
      const issued = sessionFromTokens(tokens, now())
      if (!issued) {
        throw new Error('The provider issued no ID token the app can use.')
      }
      const session: Session = withGoogle ? { ...issued, via: 'google' } : issued
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

  // A share opens "Add a task" once the board is current and nothing else is open over it: not
  // while signed out, nor over the kept board, which takes no change (#272), nor over a form, the
  // account sheet or a file, whatever they hold. Set while rendering, as React has state adjusted
  // to other state, rather than in an effect that would render the board once more without it.
  const [next] = shares
  if (next && state.kind === 'board' && !state.kept && !form && !account && !viewing) {
    const { draft: share, number } = next
    const refused = share.refused
      .map((each) =>
        each.refusal === 'UNREADABLE'
          ? messages.attachments.unreadable(each.name)
          : messages.attachments.refusals[each.refusal](each.name),
      )
      .join('\n')
    setForm({
      description: share.description,
      pending: share.files,
      shared: share.files,
      links: share.links,
      share: number,
      opened: `share-${number}`,
      failure: refused || undefined,
    })
    setShares((waiting) => waiting.slice(1))
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
   * A change that got no answer in time may have arrived all the same (#311), so the board is
   * loaded again: it shows whether it did, and until a load works the board counts as possibly out
   * of date and refuses changes (#272) -- a second try sent blind could add the task twice.
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
    if (cause instanceof TimedOutError) {
      reload()
    }
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
    let attachLater: { task: BoardTask; files: PickedFile[]; links: SharedLink[] } | undefined
    setFailure(undefined)
    if (task && !markBusy(task, true)) {
      return false
    }
    if (started?.shared) {
      sharesSaving.current.add(started.shared)
    }
    try {
      await sending(async () => {
        if (task) {
          const saved = await changes.update(await caller(), { ...task, ...values })
          replace(saved)
          keep((kept) => kept.set(saved.id, saved))
        } else {
          const draft = started?.opened === undefined ? undefined : draftUploads.current.get(started.opened)
          const input = { ...values, state: 'TODO' } as const
          let created: BoardTask | undefined
          if (changes.drafts && draft?.id !== undefined && !draft.unavailable) {
            try {
              created = await changes.drafts.add(await caller(), draft.id, input)
              draft.added = true
            } catch (cause) {
              // Swept while the form stood open past the hour (#381): added the way it was before
              // drafts, its files uploaded again from the phone.
              if (!(cause instanceof RequestFailedError && cause.status === 404)) {
                throw cause
              }
              draft.unavailable = true
              draft.uploaded.clear()
            }
          }
          created ??= await changes.create(await caller(), input)
          setTasks((tasks) => [...tasks, created])
          keep((kept) => kept.set(created.id, created))
          // What is not on the draft yet -- all of it, without one -- goes up now, as before #381.
          attachLater = {
            task: created,
            files: (started?.pending ?? []).filter((file) => !draft?.uploaded.has(file)),
            links: started?.links ?? [],
          }
        }
      })
      if (attachLater) {
        await attachPending(attachLater.task, attachLater.files, attachLater.links)
      }
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
      if (started?.shared) {
        sharesSaving.current.delete(started.shared)
        // Closed while it was added: its copies are let go now. Still open, they go with the form.
        if (formNow.current?.shared !== started.shared) {
          forgetShare(started.shared)
        }
      }
    }
  }

  /** The website's words for why a file was not attached, or null when it was no refusal. */
  const refusalText = (cause: unknown, fileName: string) =>
    cause instanceof AttachmentRefusedError ? messages.attachments.refusals[cause.refusal](fileName) : null

  /** Adds a file just attached to its task: on the board, in the editor and in the board kept. */
  const addFile = (taskId: Task['id'], attachment: Attachment) => {
    const withFile = (each: BoardTask): BoardTask =>
      each.id === taskId ? { ...each, attachments: [...(each.attachments ?? []), attachment] } : each
    setTasks((tasks) => tasks.map(withFile))
    keep((kept) => {
      const stored = kept.get(taskId)
      if (stored) {
        kept.set(taskId, withFile(stored))
      }
    })
    setForm((current) => (current?.task?.id === taskId ? { ...current, task: withFile(current.task) } : current))
  }

  /** Uploads a file to a task, saying how far it has got; resolves to why not, or null once attached. */
  const uploadTo = async (task: BoardTask, file: PickedFile, adding = false): Promise<string | null> => {
    const upload = files?.upload
    if (!upload) {
      return null
    }
    const taskId = adding ? 'new' : task.id
    setUploading({ taskId, name: file.name, fraction: 0 })
    try {
      const attachment = await sending(async () =>
        upload(await caller(), task.id, file, (fraction) => setUploading({ taskId, name: file.name, fraction })),
      )
      addFile(task.id, attachment)
      return null
    } catch (cause) {
      if (cause instanceof KeptBoardShownError) {
        setRefused(true)
        return messages.offline.readOnly
      }
      return refusalText(cause, file.name) ?? (await failed(cause, messages.attachments.uploadFailed(file.name))) ?? ''
    } finally {
      setUploading(null)
    }
  }

  /**
   * Picks a file and attaches it (#274): at once to the task being edited, or, while adding one,
   * held until it exists -- refused at once, as the website's add row does, when the backend would
   * refuse it anyway.
   */
  const attach = async (source: PickSource) => {
    const task = form?.task
    if (!pickFile || (task && !markBusy(task, true))) {
      return
    }
    const sameForm = (current: Form | null) => current !== null && current.task?.id === task?.id
    const say = (failure: string | undefined) => setForm((current) => (sameForm(current) ? { ...current!, failure } : current))
    try {
      if (task && refusedWhileKept()) {
        say(messages.offline.readOnly)
        return
      }
      say(undefined)
      let file: PickedFile | null
      try {
        file = await pickFile(source)
      } catch (cause) {
        console.warn('No file could be picked', cause)
        say(cause instanceof CameraRefusedError ? messages.attachments.cameraRefused : messages.errors.uploadAttachment)
        return
      }
      if (!file) {
        return
      }
      if (task) {
        const failure = await uploadTo(task, file)
        if (failure) {
          // The editor may have been closed meanwhile: then the board says it.
          if (sameForm(formNow.current)) {
            say(failure)
          } else {
            setFailure(failure)
          }
        }
        return
      }
      const refusal = checkFile(file)
      if (refusal) {
        say(messages.attachments.refusals[refusal](file.name))
        return
      }
      const picked = file
      setForm((current) =>
        sameForm(current) && (current!.pending?.length ?? 0) < attachmentLimits.perTask
          ? { ...current!, pending: [...(current!.pending ?? []), picked] }
          : current,
      )
    } finally {
      if (task) {
        markBusy(task, false)
      }
    }
  }

  /** Attaches the files picked while a task was added, now that it exists; says which could not be. */
  const attachPending = async (task: BoardTask, picked: PickedFile[], links: SharedLink[] = []) => {
    const failures: string[] = []
    for (const file of picked) {
      const failure = await uploadTo(task, file, true)
      if (failure) {
        failures.push(failure)
      }
    }
    for (const link of links) {
      const failure = await addLinkTo(task, link)
      if (failure) {
        failures.push(failure)
      }
    }
    if (failures.length > 0) {
      setFailure(failures.join('\n'))
    }
  }

  /** Adds a link a share brought to its task (#414); resolves to why not, or null once added. */
  const addLinkTo = async (task: BoardTask, link: SharedLink): Promise<string | null> => {
    const add = files?.addLink
    if (!add) {
      return null
    }
    const name = link.title ?? link.url
    try {
      const attachment = await sending(async () => add(await caller(), task.id, link))
      addFile(task.id, attachment)
      return null
    } catch (cause) {
      if (cause instanceof KeptBoardShownError) {
        setRefused(true)
        return messages.offline.readOnly
      }
      return refusalText(cause, name) ?? (await failed(cause, messages.attachments.linkFailed(name))) ?? ''
    }
  }

  /** The draft of the add form with this number, made when first asked for. */
  const draftOf = (opened: string) => {
    let draft = draftUploads.current.get(opened)
    if (!draft) {
      draft = { uploaded: new Map() }
      draftUploads.current.set(opened, draft)
    }
    return draft
  }

  /** Discards a draft whose form closed without Add; one that cannot be is swept on the backend. */
  const discardDraft = (draft: DraftUploads) => {
    const id = draft.id
    if (id === undefined || draft.added || !changes.drafts) {
      return
    }
    void caller()
      .then((asWhom) => changes.drafts!.discard(asWhom, id))
      .catch((cause: unknown) => console.warn('The draft could not be discarded; the backend sweeps it', cause))
  }

  /** Takes a file let go in the form off its draft, where it had got to already. */
  const letGoFromDraft = (opened: string | undefined, file: PickedFile) => {
    const draft = opened === undefined ? undefined : draftUploads.current.get(opened)
    const attachment = draft?.uploaded.get(file)
    if (!draft || draft.id === undefined || !attachment || !files) {
      return
    }
    draft.uploaded.delete(file)
    const id = draft.id
    void caller()
      .then((asWhom) => files.remove(asWhom, id, attachment.id))
      .catch((cause: unknown) => console.warn('A file let go could not be taken off the draft', cause))
  }

  /**
   * Uploads one file of the add form with this number to its draft (#381), starting the draft
   * first; says in the form why a file could not go, and leaves it out.
   */
  const uploadToDraft = async (opened: string, file: PickedFile) => {
    const draft = draftOf(opened)
    const upload = files?.upload
    if (!changes.drafts || !upload) {
      return
    }
    if (draft.id === undefined) {
      try {
        draft.id = await sending(async () => changes.drafts!.start(await caller()))
      } catch (cause) {
        // A backend from before drafts, or none to be had now: the files wait for Add.
        console.warn('No draft could be started; the files wait for Add', cause)
        draft.unavailable = true
        return
      }
      if (formNow.current?.opened !== opened) {
        discardDraft(draft)
        return
      }
    }
    const id = draft.id
    setUploading({ taskId: 'new', name: file.name, fraction: 0 })
    try {
      const attachment = await sending(async () =>
        upload(await caller(), id, file, (fraction) => setUploading({ taskId: 'new', name: file.name, fraction })),
      )
      draft.uploaded.set(file, attachment)
      // Let go while it went up: off the draft again.
      if (formNow.current?.opened !== opened || !formNow.current.pending?.includes(file)) {
        letGoFromDraft(opened, file)
      }
    } catch (cause) {
      const text = refusalText(cause, file.name) ?? (await failed(cause, messages.attachments.uploadFailed(file.name)))
      if (text === null) {
        // Nothing to say -- the board shown is not current, or the sign-in ended: the files wait
        // for Add, as before drafts, rather than vanish.
        draft.unavailable = true
        return
      }
      setForm((current) =>
        current?.opened === opened
          ? { ...current, pending: current.pending?.filter((each) => each !== file), failure: text || current.failure }
          : current,
      )
    } finally {
      setUploading(null)
    }
  }

  // An add form's files go up while it is open (#381): one at a time, each as soon as the last one
  // is up, to the form's draft.
  useEffect(() => {
    const opened = form?.opened
    if (opened === undefined || form?.task || !changes.drafts || !files?.upload || uploading || draftBusy.current) {
      return
    }
    const draft = draftOf(opened)
    const next = draft.unavailable ? undefined : form?.pending?.find((file) => !draft.uploaded.has(file))
    if (!next) {
      return
    }
    draftBusy.current = true
    // After this render, not in it: the upload says how far it has got from its first step.
    queueMicrotask(() => {
      setDraftWorking(true)
      void uploadToDraft(opened, next).finally(() => {
        draftBusy.current = false
        setDraftWorking(false)
        setDraftTurn((turn) => turn + 1)
      })
    })
  })

  // Closed without Add -- cancelled, or closed by a sign-out -- its draft goes with its files. After
  // every render, as the form or an upload's end may have changed which drafts are left.
  useEffect(() => {
    for (const [opened, draft] of draftUploads.current) {
      if (opened !== form?.opened && !draftBusy.current) {
        draftUploads.current.delete(opened)
        discardDraft(draft)
      }
    }
  })

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

  /**
   * A link to a file or its thumbnail (#274): the one asked for in the last few minutes, and a new
   * one otherwise. Asked as whoever is signed in, kept board or not: showing a file changes nothing.
   */
  const fileLink = (taskId: Task['id'], attachmentId: Attachment['id'], thumbnail: boolean): Promise<string> => {
    const key = `${taskId}/${attachmentId}/${thumbnail}`
    const known = links.current.get(key)
    if (known && known.until > now()) {
      return known.link
    }
    const link = (async () => {
      if (!files) {
        throw new Error('This app cannot show files.')
      }
      return files.link(await signedInCaller(), taskId, attachmentId, thumbnail)
    })()
    links.current.set(key, { link, until: now() + LINK_KEPT_MS })
    // A failed ask is not kept: the next one asks again.
    link.catch(() => {
      if (links.current.get(key)?.link === link) {
        links.current.delete(key)
      }
    })
    return link
  }
  const latestFileLink = useRef(fileLink)
  useEffect(() => {
    latestFileLink.current = fileLink
  })
  /**
   * Where a preview is shown from, with one identity for the app's lifetime, so a preview asks once
   * and not per render: its copy kept on the phone, which needs no connection (#397), or else its
   * link -- shown at once, and kept meanwhile for the next time.
   */
  const previewLink = useCallback(
    async (taskId: Task['id'], attachmentId: Attachment['id'], thumbnail: boolean) => {
      const kept = await previews.find(attachmentId, thumbnail).catch(() => null)
      if (kept) {
        return kept
      }
      const session = signOuts.current
      const url = await latestFileLink.current(taskId, attachmentId, thumbnail)
      // A link that arrives after a sign-out is not kept: the previews went with that session.
      // Not kept, it is asked for again the next time: nothing worth a notice.
      if (signOuts.current === session) {
        previews.keep(attachmentId, thumbnail, url).catch(() => undefined)
      }
      return url
    },
    [previews],
  )

  /**
   * Opens a file: an image in the app's own viewer, anything else in the phone's. One at a time;
   * and once the link is there, only if the user is still where they asked -- signed in as then,
   * with no form or sheet opened meanwhile.
   *
   * A link that could not be had is not a change gone wrong: nothing is reloaded or refused for it.
   */
  const openFile = async (task: BoardTask, attachment: Attachment) => {
    // A link opens its own address in the browser (#414), and only a web address.
    if (isLink(attachment)) {
      if (attachment.url && isWebAddress(attachment.url)) {
        await Linking.openURL(attachment.url).catch((cause) => console.warn('A link could not be opened', cause))
      }
      return
    }
    if (opening.current) {
      return
    }
    opening.current = true
    const session = signOuts.current
    setFailure(undefined)
    try {
      const url = await fileLink(task.id, attachment.id, false)
      if (session !== signOuts.current || sheetOpen.current) {
        return
      }
      if (isImage(attachment)) {
        setViewing({ url, fileName: attachment.fileName })
      } else {
        await documents?.open(url, attachment.fileName, attachment.contentType)
      }
    } catch (cause) {
      if (cause instanceof SignedOutError) {
        await signOut('sessionExpired')
        return
      }
      console.warn('A file could not be opened', cause)
      if (session === signOuts.current) {
        setFailure(messages.errors.openAttachment)
      }
    } finally {
      opening.current = false
    }
  }

  /** Removes a file from its task for good, on the board, in the editor and in the board kept. */
  const removeFile = async (task: BoardTask, attachment: Attachment) => {
    if (!files || !markBusy(task, true)) {
      return
    }
    if (refusedWhileKept()) {
      // The board's notice is hidden under the form: the form says it too.
      setForm((current) => (current?.task?.id === task.id ? { ...current, failure: messages.offline.readOnly } : current))
      markBusy(task, false)
      return
    }
    const without = (each: BoardTask): BoardTask =>
      each.id === task.id ? { ...each, attachments: each.attachments?.filter((kept) => kept.id !== attachment.id) } : each
    setForm((current) => (current?.task?.id === task.id ? { ...current, failure: undefined } : current))
    try {
      await sending(async () => files.remove(await caller(), task.id, attachment.id))
      for (const thumbnail of [false, true]) {
        links.current.delete(`${task.id}/${attachment.id}/${thumbnail}`)
      }
      setTasks((tasks) => tasks.map(without))
      keep((kept) => {
        const stored = kept.get(task.id)
        if (stored) {
          kept.set(task.id, without(stored))
        }
      })
      setForm((current) => (current?.task?.id === task.id ? { ...current, task: without(current.task) } : current))
    } catch (cause) {
      const text = await failed(cause, messages.errors.removeAttachment)
      if (text) {
        setForm((current) => (current?.task?.id === task.id ? { ...current, failure: text } : current))
      }
    } finally {
      markBusy(task, false)
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
            darkMode={darkMode}
            language={language}
            appVersion={appVersion}
            messages={messages}
            styles={styles}
            notice={state.notice}
            onSignIn={() => signIn()}
            onSignInWithGoogle={google && variant.google ? () => signIn(true) : undefined}
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
              onAdd={() => {
                if (!refusedWhileKept()) {
                  addsOpened.current += 1
                  setForm({ opened: `add-${addsOpened.current}` })
                }
              }}
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
              files={files ? { link: previewLink, onOpen: (task, attachment) => void openFile(task, attachment) } : undefined}
              offer={
                offerReminders && !state.kept && remindable
                  ? { onTurnOn: () => void turnOnReminders(), onNotNow: declineReminders }
                  : undefined
              }
              legend={explainColours ? { onDismiss: dismissLegend } : undefined}
            />
            <Modal
              testID="task-form"
              visible={form !== null}
              animationType="slide"
              presentationStyle="pageSheet"
              onRequestClose={() => setForm(null)}
            >
              {form ? (
                <TaskForm
                  key={form.task?.id ?? (form.share ? `share-${form.share}` : 'new')}
                  task={form.task}
                  today={today}
                  language={language}
                  messages={messages}
                  styles={styles}
                  theme={theme}
                  failure={form.failure}
                  onSave={save}
                  onDelete={form.task ? () => void remove([form.task!]) : undefined}
                  onRemoveFile={files && form.task ? (attachment) => void removeFile(form.task!, attachment) : undefined}
                  busy={form.task ? busy.has(form.task.id) : draftWorking}
                  pending={form.task ? undefined : (form.pending ?? [])}
                  pendingLinks={form.task ? undefined : form.links}
                  onUnpickLink={(link) =>
                    setForm((current) => current && { ...current, links: current.links?.filter((each) => each !== link) })
                  }
                  draft={form.description}
                  uploading={uploading?.taskId === (form.task?.id ?? 'new') ? uploading : null}
                  onAttach={files?.upload && pickFile ? (source) => void attach(source) : undefined}
                  onUnpick={(file) => {
                    setForm((current) => current && { ...current, pending: current.pending?.filter((each) => each !== file) })
                    letGoFromDraft(form.opened, file)
                  }}
                  onCancel={() => setForm(null)}
                />
              ) : null}
            </Modal>
            <FileViewer file={viewing} messages={messages} styles={styles} onClose={() => setViewing(null)} />
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
  darkMode,
  onSignIn,
  onSignInWithGoogle,
}: {
  variant: Variant
  language: Language
  appVersion: string
  messages: Messages
  styles: Styles
  notice?: SignedOutNotice
  /** Whether the phone is in dark mode, which Google's button follows. */
  darkMode: boolean
  onSignIn: () => void
  /** Present where the variant signs in with Google and the app can (#280). */
  onSignInWithGoogle?: () => void
}) {
  return (
    <View style={styles.board}>
      <View style={styles.signedOutHead}>
        <AboutLink messages={messages} styles={styles} />
      </View>
      <View style={styles.signedOut}>
        <Text style={styles.title}>TaskFest</Text>
        <Text style={styles.muted}>{messages.signedOut.tagline}</Text>
        {notice ? (
          <Text style={notice === 'accountDeleted' ? styles.muted : styles.notice}>{noticeText(notice, messages)}</Text>
        ) : null}
        {onSignInWithGoogle ? (
          <GoogleButton darkMode={darkMode} label={messages.signedOut.google} styles={styles} onPress={onSignInWithGoogle} />
        ) : null}
        {variant.signIn ? (
          <Pressable accessibilityRole="button" style={styles.button} onPress={onSignIn}>
            <Text style={styles.buttonText}>{messages.signedOut.signInWith(variant.signIn.label)}</Text>
          </Pressable>
        ) : onSignInWithGoogle ? null : (
          <Text style={styles.muted}>{messages.signedOut.notConfigured}</Text>
        )}
      </View>
      <LegalLinks language={language} messages={messages} styles={styles} appVersion={appVersion} />
    </View>
  )
}

/**
 * Google's official sign-in button, as the website shows it (#325): Google's rules allow its "G"
 * only inside its own button, in its own light or dark theme, so the image is the button. Its
 * words are Google's English whatever the app speaks, and the screen reader is told so on iOS;
 * Android's has no way to be told.
 */
function GoogleButton({
  darkMode,
  label,
  styles,
  onPress,
}: {
  darkMode: boolean
  label: string
  styles: Styles
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityLanguage="en"
      // Google draws it 40 high; the finger gets the 48 a touch target should have.
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.googleButton, pressed && styles.pressed]}
      onPress={onPress}
    >
      <Image testID="google-sign-in-image" source={darkMode ? googleSignInButton.dark : googleSignInButton.light} style={styles.googleImage} />
    </Pressable>
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
