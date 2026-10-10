import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { SignedOutError, type Caller } from './api'
import { boardOf, type Board } from './board'
import type { Session } from './session'
import { currentSession, sessionFromTokens, type Refresh, type SessionStore, type Tokens } from './staySignedIn'
import { dark, light, type Theme } from './theme'
import type { Variant } from './variants'
import { catalogues, describeDueDate, localeOf, todayIso, type Language, type Messages, type Task } from './web'

/** What the app needs from outside itself, handed in so tests can stand in for each. */
export type Dependencies = {
  sessions: SessionStore
  provider: { signIn(): Promise<Tokens | null>; refresh: Refresh }
  fetchTasks(caller: Caller): Promise<Task[]>
  now(): number
}

type State =
  | { kind: 'starting' }
  | { kind: 'signedOut'; notice?: 'sessionExpired' }
  | { kind: 'loading' }
  | { kind: 'board'; board: Board }
  | { kind: 'failed' }

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
  const { sessions, provider, fetchTasks, now } = dependencies
  const messages = catalogues[language]
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

  useEffect(() => {
    void (async () => {
      const session = await currentSession(sessions, provider.refresh, now())
      if (session) {
        await showBoard(session)
      } else {
        setState({ kind: 'signedOut' })
      }
    })()
  }, [now, provider, sessions, showBoard])

  const signIn = async () => {
    const tokens = await provider.signIn()
    const session = tokens ? sessionFromTokens(tokens, now()) : null
    if (session) {
      await sessions.save(session)
      await showBoard(session)
    }
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        {state.kind === 'signedOut' ? (
          <SignedOutScreen variant={variant} messages={messages} styles={styles} notice={state.notice} onSignIn={signIn} />
        ) : state.kind === 'board' ? (
          <BoardScreen board={state.board} today={todayIso(new Date(now()))} language={language} messages={messages} styles={styles} />
        ) : state.kind === 'failed' ? (
          <Text style={styles.notice}>{messages.failures.loading}</Text>
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
  styles,
  notice,
  onSignIn,
}: {
  variant: Variant
  messages: Messages
  styles: Styles
  notice?: 'sessionExpired'
  onSignIn: () => void
}) {
  return (
    <View style={styles.signedOut}>
      <Text style={styles.title}>TaskFest</Text>
      <Text style={styles.muted}>{messages.signedOut.tagline}</Text>
      {notice ? <Text style={styles.notice}>{messages.board.sessionExpired}</Text> : null}
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
  styles,
}: {
  board: Board
  today: string
  language: Language
  messages: Messages
  styles: Styles
}) {
  if (board.sections.length === 0 && board.completed.length === 0) {
    return <Text style={styles.muted}>{messages.board.empty}</Text>
  }
  const row = (task: Task, sayWhen: boolean) => (
    <View key={task.id} style={styles.row}>
      <View style={[styles.dot, styles[`importance${task.importance}`]]} />
      <Text style={[styles.description, task.state === 'DONE' && styles.done]}>{task.description}</Text>
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
    description: { flex: 1, color: theme.text },
    done: { color: theme.textMuted, textDecorationLine: 'line-through' },
  })
}
