import { useEffect } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { BoardTask } from './api'
import { boardOf, isChangeable } from './board'
import type { Styles } from './styles'
import { describeDueDate, localeOf, type Language, type Messages } from './web'

/** How long the offer to undo a delete stands: the website's eight seconds. */
const UNDO_FOR_MS = 8000

/**
 * The board (#267, #271): the website's sections and order, a tick to complete or reopen a task, a
 * tap on it to edit it, and the add button, the offer to undo a delete and any failure below.
 *
 * A task holding an importance or state a newer backend added is shown but not offered for any
 * change: the backend replaces a whole task, so saving it would overwrite the value the app does
 * not know with its stand-in.
 */
export function BoardScreen({
  tasks,
  today,
  language,
  messages,
  styles,
  failure,
  deleted,
  busy,
  onAdd,
  onOpen,
  onToggle,
  onClearCompleted,
  onUndo,
  onDismissUndo,
}: {
  tasks: BoardTask[]
  today: string
  language: Language
  messages: Messages
  styles: Styles
  /** What went wrong with the last change, in the user's language. */
  failure?: string
  /** How many tasks were just deleted and can still be put back; a new key for each delete. */
  deleted?: { count: number; key: number }
  /** The tasks with a change on its way, which wait for it before they take another. */
  busy: ReadonlySet<number>
  onAdd: () => void
  onOpen: (task: BoardTask) => void
  onToggle: (task: BoardTask) => void
  onClearCompleted: () => void
  onUndo: () => void
  /** Must keep its identity across renders, or the undo's countdown starts over with each. */
  onDismissUndo: () => void
}) {
  const board = boardOf(tasks, today)
  const clearable = board.completed.some(isChangeable)

  const row = (task: BoardTask, sayWhen: boolean) => {
    const changeable = isChangeable(task)
    const done = task.state === 'DONE'
    return (
      <View key={task.id} testID={`task-${task.id}`} style={styles.row}>
        {changeable ? (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={messages.row.markDone(task.description)}
            accessibilityState={{ checked: done, disabled: busy.has(task.id) }}
            disabled={busy.has(task.id)}
            hitSlop={8}
            style={[styles.check, done && styles.checked]}
            onPress={() => onToggle(task)}
          >
            {done ? <Text style={styles.tick}>✓</Text> : null}
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole={changeable ? 'button' : undefined}
          accessibilityLabel={changeable ? messages.editor.label(task.description) : undefined}
          disabled={!changeable}
          style={styles.rowBody}
          onPress={() => onOpen(task)}
        >
          {task.unknown?.includes('importance') ? (
            // An importance a newer backend added (#268): marked, not guessed.
            <View accessibilityLabel={messages.row.unknown} style={[styles.dot, styles.unknownDot]} />
          ) : (
            <View style={[styles.dot, styles[`importance${task.importance}`]]} />
          )}
          <View style={styles.description}>
            <Text style={[styles.description, done && styles.done]}>{task.description}</Text>
            {changeable ? null : <Text style={styles.muted}>{messages.row.updateToChange}</Text>}
          </View>
          {task.unknown?.includes('state') ? (
            // A state a newer backend added (#268): kept open, and said to be unknown.
            <Text style={styles.muted}>{messages.row.unknown}</Text>
          ) : null}
          {sayWhen ? (
            <Text style={styles.muted}>{describeDueDate(task.dueDate, today, messages.dates, localeOf(language))}</Text>
          ) : null}
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.board}>
      <ScrollView style={styles.board} contentContainerStyle={styles.boardContent}>
        {failure ? (
          <Text accessibilityRole="alert" style={styles.notice}>
            {failure}
          </Text>
        ) : null}
        {board.sections.length === 0 && board.completed.length === 0 ? (
          <Text style={styles.muted}>{messages.board.emptyShort}</Text>
        ) : null}
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
            <View style={styles.sectionHead}>
              <Text style={styles.heading}>{messages.completed.title(board.completed.length)}</Text>
              {clearable ? (
                <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onClearCompleted}>
                  <Text style={styles.quietButtonText}>{messages.completed.clear}</Text>
                </Pressable>
              ) : null}
            </View>
            {board.completed.map((task) => row(task, true))}
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        {deleted ? (
          <UndoOffer key={deleted.key} count={deleted.count} messages={messages} styles={styles} onUndo={onUndo} onDismiss={onDismissUndo} />
        ) : null}
        <Pressable accessibilityRole="button" style={styles.button} onPress={onAdd}>
          <Text style={styles.buttonText}>{messages.addRow.open}</Text>
        </Pressable>
      </View>
    </View>
  )
}

/** The website's undo toast, as a bar above the add button: instead of "are you sure?". */
function UndoOffer({
  count,
  messages,
  styles,
  onUndo,
  onDismiss,
}: {
  count: number
  messages: Messages
  styles: Styles
  onUndo: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, UNDO_FOR_MS)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <View accessibilityRole="alert" style={styles.undo}>
      <Text style={styles.description}>{messages.undo.deleted(count)}</Text>
      <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onUndo}>
        <Text style={styles.quietButtonText}>{messages.undo.undo}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={messages.undo.dismiss}
        style={styles.quietButton}
        onPress={onDismiss}
      >
        <Text style={styles.quietButtonText}>×</Text>
      </Pressable>
    </View>
  )
}
