import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { SignedOutError, type BoardTask, type Caller } from './api'
import { isTooOld } from './appVersion'
import { boardOf, type Board } from './board'
import type { Session } from './session'
import { appCatalogues, type AppMessages } from './messages'
import {
  RenewalUnavailableError,
  currentSession,
  sessionFromTokens,
  type Refresh,
  type SessionStore,
  type Tokens,
} from './staySignedIn'
import { dark, light, type Theme } from './theme'
import type { Variant } from './variants'
import { catalogues, describeDueDate, localeOf, todayIso, type Language, type Messages } from './web'

/** What the app needs from outside itself, handed in so tests can stand in for each. */
export type Dependencies = {
  sessions: SessionStore
  provider: { signIn(): Promise<Tokens | null>; refresh: Refresh }
  fetchTasks(caller: Caller): Promise<BoardTask[]>
  /** The oldest app release the backend serves (#268). */
  fetchMinimumAppVersion(): Promise<string>
  /** This build's release: the tag's, or 0.0.0 from a branch. */
  appVersion: string
  now(): number
}

/** How long the start waits to hear which releases the backend serves before carrying on. */
const VERSION_CHECK_MS = 3000

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
  | { kind: 'board'; board: Board }
  | { kind: 'failed' }
  | { kind: 'tooOld' }

/**
 * The app, from sign-in to the board (#267): read-only for now, in the user's language, in the
 * website's colours and the website's order.
 *
 * It opens on the board when a session is kept on the phone and still good; otherwise on the
 * variant's sign-in. A board the backend refuses to serve (401) ends the session and says so, as
 * the website does when its cookie has expired.
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
  const { sessions, provider, fetchTasks, fetchMinimumAppVersion, appVersion, now } = dependencies
  const messages = catalogues[language]
  const appMessages = appCatalogues[language]
  const theme = useColorScheme() === 'dark' ? dark : light
  const styles = useMemo(() => stylesFor(theme), [theme])
  const [state, setState] = useState<State>({ kind: 'starting' })

  const showBoard = useCallback(
    async (session: Session) => {
      setState({ kind: 'loading' })
      try {
        const tasks = await fetchTasks({ baseUrl: variant.apiBaseUrl, idToken: session.idToken })
        setState({ kind: 'board', board: boardOf(tasks, todayIso(new Date(now()))) })
      } catch (failure) {
        if (failure instanceof SignedOutError) {
          await sessions.clear()
          setState({ kind: 'signedOut', notice: 'sessionExpired' })
        } else {
          setState({ kind: 'failed' })
        }
      }
    },
    [fetchTasks, now, sessions, variant.apiBaseUrl],
  )

  /** How often the start has been tried: "try again" raises it, and the effect below runs anew. */
  const [attempt, setAttempt] = useState(0)

  // Back in the foreground, the app starts over: the backend may no longer serve this release,
  // and the board may have changed meanwhile.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
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
        currentSession(sessions, provider.refresh, now()).then(
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
  }, [appVersion, attempt, fetchMinimumAppVersion, now, provider, sessions, showBoard])

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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        {state.kind === 'signedOut' ? (
          <SignedOutScreen
            variant={variant}
            messages={messages}
            appMessages={appMessages}
            styles={styles}
            notice={state.notice}
            onSignIn={signIn}
          />
        ) : state.kind === 'board' ? (
          <BoardScreen
            board={state.board}
            today={todayIso(new Date(now()))}
            language={language}
            messages={messages}
            appMessages={appMessages}
            styles={styles}
          />
        ) : state.kind === 'tooOld' ? (
          <View style={styles.signedOut}>
            <Text style={styles.notice}>{appMessages.updateRequired}</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={retry}>
              <Text style={styles.buttonText}>{appMessages.tryAgain}</Text>
            </Pressable>
          </View>
        ) : state.kind === 'failed' ? (
          <View style={styles.signedOut}>
            <Text style={styles.notice}>{messages.failures.loading}</Text>
            <Pressable accessibilityRole="button" style={styles.button} onPress={retry}>
              <Text style={styles.buttonText}>{appMessages.tryAgain}</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={theme.accent} accessibilityLabel={messages.board.loading} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

type Styles = ReturnType<typeof stylesFor>

function SignedOutScreen({
  variant,
  messages,
  appMessages,
  styles,
  notice,
  onSignIn,
}: {
  variant: Variant
  messages: Messages
  appMessages: AppMessages
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
          {notice === 'sessionExpired' ? messages.board.sessionExpired : appMessages.signInFailed}
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

function BoardScreen({
  board,
  today,
  language,
  messages,
  appMessages,
  styles,
}: {
  board: Board
  today: string
  language: Language
  messages: Messages
  appMessages: AppMessages
  styles: Styles
}) {
  if (board.sections.length === 0 && board.completed.length === 0) {
    return <Text style={styles.muted}>{appMessages.emptyBoard}</Text>
  }
  const row = (task: BoardTask, sayWhen: boolean) => (
    <View key={task.id} style={styles.row}>
      {task.unknown?.includes('importance') ? (
        // An importance a newer backend added (#268): marked, not guessed.
        <View accessibilityLabel={appMessages.unknownValue} style={[styles.dot, styles.unknownDot]} />
      ) : (
        <View style={[styles.dot, styles[`importance${task.importance}`]]} />
      )}
      <Text style={[styles.description, task.state === 'DONE' && styles.done]}>{task.description}</Text>
      {task.unknown?.includes('state') ? (
        // A state a newer backend added (#268): kept open, and said to be unknown.
        <Text style={styles.muted}>{appMessages.unknownValue}</Text>
      ) : null}
      {sayWhen ? (
        <Text style={styles.muted}>{describeDueDate(task.dueDate, today, messages.dates, localeOf(language))}</Text>
      ) : null}
    </View>
  )
  return (
    <ScrollView contentContainerStyle={styles.board}>
      {board.sections.map((section) => (
        <View key={section.bucket} style={styles.section}>
          <Text style={[styles.heading, section.bucket === 'overdue' && styles.overdue]}>
            {messages.sections[section.bucket]}
          </Text>
          {/* As on the website, the heading already says when a task is due today or tomorrow. */}
          {section.tasks.map((task) => row(task, section.bucket !== 'today' && section.bucket !== 'tomorrow'))}
        </View>
      ))}
      {board.completed.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.heading}>{messages.completed.title(board.completed.length)}</Text>
          {board.completed.map((task) => row(task, true))}
        </View>
      ) : null}
    </ScrollView>
  )
}

function stylesFor(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
    signedOut: { flex: 1, justifyContent: 'center', gap: 16 },
    title: { fontSize: 32, fontWeight: '700', color: theme.brandStrong },
    muted: { color: theme.textMuted },
    notice: { color: theme.danger },
    button: { backgroundColor: theme.accent, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16 },
    buttonText: { color: theme.accentContrast, fontWeight: '600', textAlign: 'center' },
    board: { paddingVertical: 16, gap: 24 },
    section: { gap: 8 },
    heading: { fontSize: 18, fontWeight: '700', color: theme.text },
    overdue: { color: theme.danger },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    importanceLOW: { backgroundColor: theme.importanceLow },
    importanceMEDIUM: { backgroundColor: theme.importanceMedium },
    importanceHIGH: { backgroundColor: theme.importanceHigh },
    unknownDot: { borderWidth: 1, borderColor: theme.textMuted },
    description: { flex: 1, color: theme.text },
    done: { color: theme.textMuted, textDecorationLine: 'line-through' },
  })
}
