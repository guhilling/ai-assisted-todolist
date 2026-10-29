import { useContext, useEffect, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import type { BoardTask } from './api'
import { AttachFiles, EditorFiles, PendingFiles, PendingLinks } from './Attachments'
import type { SharedLink } from './incoming'
import type { PickSource } from './pick'
import type { PickedFile } from './upload'
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
  type Attachment,
} from './web'

/** What the form sets: everything about a task but its id and its files. */
export type TaskValues = Pick<Task, 'description' | 'dueDate' | 'importance' | 'state'>

/** A task is open or done (#334); `WORKING`, which older apps still send, is not offered. */
const STATES = ['TODO', 'DONE'] as const
type OfferedState = (typeof STATES)[number]

/**
 * Adding a task, or editing one (#271): the description, the due date -- the website's shortcuts,
 * or any day from the platform's calendar -- the importance, and when editing, the state.
 *
 * Saving waits for the server, as the website's editor does: the form stays open with what was
 * typed until the save went through, and a refused save leaves it there to correct. Whoever shows
 * the form closes it once `onSave` says the task was saved.
 *
 * The buttons sit below the fields rather than at their end, and the whole gives way to the
 * keyboard (#382): the fields scroll in what is left above it, and Add stays in reach while the
 * description is typed, where it used to be under the keyboard. A refused save says so beside the
 * buttons, where it is seen, not at the end of fields the keyboard has left scrolled away.
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
  onRemoveFile,
  busy = false,
  pending,
  pendingLinks,
  uploading = null,
  onAttach,
  onUnpick,
  onUnpickLink,
  onCancel,
  draft,
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
  /** Removes one of the task's files (#274); none where files cannot be removed here. */
  onRemoveFile?: (attachment: Attachment) => void
  /** Whether a change to the task is on its way; its files wait for it before another. */
  busy?: boolean
  /** Files picked while adding the task, attached once it exists (#274). */
  pending?: PickedFile[]
  /** Links a share brought while adding the task, added once it exists (#414). */
  pendingLinks?: SharedLink[]
  /** The file uploading, and how far it has got. */
  uploading?: { name: string; fraction: number } | null
  /** Attaches a file from the source (#274); none where files cannot be attached here. */
  onAttach?: (source: PickSource) => void
  /** Lets a file picked while adding go again. */
  onUnpick?: (file: PickedFile) => void
  /** Lets a link a share brought go again (#414). */
  onUnpickLink?: (link: SharedLink) => void
  onCancel: () => void
  /** A description to add a task with, as a share brought it (#355); a task being edited has its own. */
  draft?: string
}) {
  const editing = task !== undefined
  const [description, setDescription] = useState(task?.description ?? draft ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? addDays(today, 1))
  const [importance, setImportance] = useState<TaskImportance>(task?.importance ?? 'MEDIUM')
  // A task still in progress is shown, and saved, as the open task it now is (#334).
  const [state, setState] = useState<OfferedState>(task?.state === 'DONE' ? 'DONE' : 'TODO')
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)

  const shortcuts = quickDates(today, messages.dates)
  const otherDate = shortcuts.some((quick) => quick.iso === dueDate)
    ? messages.dueDate.other
    : describeDueDate(dueDate, today, messages.dates, localeOf(language))
  const stateLabels: Record<OfferedState, string> = {
    TODO: messages.taskState.todo,
    DONE: messages.taskState.done,
  }
  const sheet = useRef<View>(null)
  // Where the form starts on the screen. The keyboard says where it starts on the screen, the view
  // giving way to it measures from the sheet's top, which iOS shows below the screen's: without
  // this the footer stayed that much under the keyboard.
  const [sheetTop, setSheetTop] = useState(0)
  // Below the footer, the home indicator or the navigation bar, while the keyboard does not cover them.
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0
  const [keyboardShown, setKeyboardShown] = useState(false)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboardShown(true))
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardShown(false))
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])
  const trimmed = description.trim()
  /** The task's files, and those picked to go with it, a share's links among them (#414). */
  const files = [...(task?.attachments ?? []), ...(pending ?? []), ...(pendingLinks ?? [])]
  // Nothing is attached to a completed task, as on the website.
  const attachable = onAttach !== undefined && task?.state !== 'DONE'
  // A change to the task on its way -- a file uploading, say -- is waited for before saving or deleting.
  const waiting = busy || uploading !== null

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
    <View ref={sheet} style={styles.formScreen} onLayout={() => sheet.current?.measureInWindow((_x, y) => setSheetTop(y))}>
      <KeyboardAvoidingView style={styles.formFields} behavior="padding" keyboardVerticalOffset={sheetTop}>
        <ScrollView testID="task-form-fields" style={styles.formFields} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
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

          {files.length > 0 || attachable ? <Text style={styles.label}>{messages.attachments.title}</Text> : null}
          {task?.attachments ? (
            <EditorFiles
              attachments={task.attachments}
              // A completed task's files may only be opened, as on the website.
              removable={onRemoveFile !== undefined && task.state !== 'DONE'}
              busy={busy}
              messages={messages}
              styles={styles}
              onRemove={(attachment) => onRemoveFile?.(attachment)}
            />
          ) : null}
          {pending ? (
            <PendingFiles files={pending} disabled={saving} messages={messages} styles={styles} onUnpick={(file) => onUnpick?.(file)} />
          ) : null}
          {pendingLinks ? (
            <PendingLinks links={pendingLinks} disabled={saving} messages={messages} styles={styles} onUnpick={(link) => onUnpickLink?.(link)} />
          ) : null}
          {attachable ? (
            <AttachFiles
              count={files.length}
              uploading={uploading}
              disabled={busy || uploading !== null || saving}
              messages={messages}
              styles={styles}
              onAttach={(source) => onAttach?.(source)}
            />
          ) : null}
        </ScrollView>

        <View testID="task-form-footer" style={[styles.formFooter, { paddingBottom: 16 + (keyboardShown ? 0 : bottomInset) }]}>
          {failure ? <Text style={styles.notice}>{failure}</Text> : null}
          <View testID="task-form-buttons" style={styles.formButtons}>
            {onDelete ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: saving || waiting }}
                disabled={saving || waiting}
                style={[styles.quietButton, { marginRight: 'auto' }, (saving || waiting) && styles.disabled]}
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
              accessibilityState={{ disabled: saving || waiting || trimmed === '' }}
              disabled={saving || waiting || trimmed === ''}
              style={[styles.button, (saving || waiting || trimmed === '') && styles.disabled]}
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
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}
