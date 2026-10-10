import { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { BoardTask } from './api'
import { DueDatePicker } from './DueDatePicker'
import type { Styles } from './styles'
import type { Theme } from './theme'
import {
  addDays,
  describeDueDate,
  importanceLevels,
  localeOf,
  quickDates,
  type Language,
  type Messages,
  type Task,
  type TaskImportance,
  type TaskState,
} from './web'

/** What the form sets: everything about a task but its id and its files. */
export type TaskValues = Pick<Task, 'description' | 'dueDate' | 'importance' | 'state'>

const STATES: TaskState[] = ['TODO', 'WORKING', 'DONE']

/**
 * Adding a task, or editing one (#271): the description, the due date -- the website's shortcuts,
 * or any day from the platform's calendar -- the importance, and when editing, the state.
 *
 * Saving waits for the server, as the website's editor does: the form stays open with what was
 * typed until the save went through, and a refused save leaves it there to correct. Whoever shows
 * the form closes it once `onSave` says the task was saved.
 */
export function TaskForm({
  task,
  today,
  language,
  messages,
  styles,
  theme,
  failure,
  onSave,
  onDelete,
  onCancel,
}: {
  /** The task to edit; none to add one. */
  task?: BoardTask
  today: string
  language: Language
  messages: Messages
  styles: Styles
  theme: Theme
  /** What went wrong with the last save, in the user's language. */
  failure?: string
  /** Saves the values; true once they are saved. */
  onSave: (values: TaskValues) => Promise<boolean>
  onDelete?: () => void
  onCancel: () => void
}) {
  const editing = task !== undefined
  const [description, setDescription] = useState(task?.description ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? addDays(today, 1))
  const [importance, setImportance] = useState<TaskImportance>(task?.importance ?? 'MEDIUM')
  const [state, setState] = useState<TaskState>(task?.state ?? 'TODO')
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  const shortcuts = quickDates(today, messages.dates)
  const otherDate = shortcuts.some((quick) => quick.iso === dueDate)
    ? messages.dueDate.other
    : describeDueDate(dueDate, today, messages.dates, localeOf(language))
  const stateLabels: Record<TaskState, string> = {
    TODO: messages.taskState.todo,
    WORKING: messages.taskState.working,
    DONE: messages.taskState.done,
  }
  const trimmed = description.trim()

  const save = async () => {
    setSaving(true)
    if (!(await onSave({ description: trimmed, dueDate, importance, state }))) {
      setSaving(false)
    }
  }

  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipActive]}
      onPress={onPress}
    >
      <Text style={selected ? styles.chipTextActive : styles.chipText}>{label}</Text>
    </Pressable>
  )

  return (
    <ScrollView style={styles.formScreen} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Text style={styles.formTitle}>{editing ? messages.editor.label(task.description) : messages.addRow.open}</Text>
      <TextInput
        testID="task-description"
        style={styles.input}
        accessibilityLabel={editing ? messages.editor.description : messages.addRow.description}
        placeholder={messages.addRow.placeholder}
        placeholderTextColor={theme.textMuted}
        value={description}
        onChangeText={setDescription}
        autoFocus={!editing}
      />

      <Text style={styles.label}>{messages.dueDate.label}</Text>
      <View style={styles.chips}>
        {shortcuts.map((quick) => chip(quick.label, quick.iso === dueDate, () => setDueDate(quick.iso)))}
        {chip(otherDate, otherDate !== messages.dueDate.other, () => setPicking(true))}
      </View>
      {picking ? (
        <DueDatePicker
          value={dueDate}
          // A new task cannot be dated in the past; an edit can, as on the website.
          minimum={editing ? undefined : today}
          onPick={(picked) => {
            setPicking(false)
            if (picked) {
              setDueDate(picked)
            }
          }}
        />
      ) : null}

      <Text style={styles.label}>{messages.importance.label}</Text>
      <View style={styles.chips}>
        {importanceLevels.map((level) =>
          chip(messages.importance.levels[level], level === importance, () => setImportance(level)),
        )}
      </View>

      {editing ? (
        <>
          <Text style={styles.label}>{messages.taskState.label}</Text>
          <View style={styles.chips}>
            {STATES.map((value) => chip(stateLabels[value], value === state, () => setState(value)))}
          </View>
        </>
      ) : null}

      {failure ? <Text style={styles.notice}>{failure}</Text> : null}

      <View style={styles.formButtons}>
        {onDelete ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            style={[styles.quietButton, { marginRight: 'auto' }, saving && styles.disabled]}
            onPress={onDelete}
          >
            <Text style={styles.dangerText}>{messages.row.delete}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onCancel}>
          <Text style={styles.quietButtonText}>{editing ? messages.editor.cancel : messages.addRow.cancel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: saving || trimmed === '' }}
          disabled={saving || trimmed === ''}
          style={[styles.button, (saving || trimmed === '') && styles.disabled]}
          onPress={save}
        >
          <Text style={styles.buttonText}>
            {editing
              ? saving
                ? messages.editor.saving
                : messages.editor.save
              : saving
                ? messages.addRow.adding
                : messages.addRow.add}
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}
