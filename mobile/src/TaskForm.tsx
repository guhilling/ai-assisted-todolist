import { useContext, useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import type { BoardTask } from './api'
import { AttachFiles, EditorFiles, PendingFiles, PendingLinks } from './Attachments'
import type { SharedLink } from './incoming'
import type { PickSource } from './pick'
import type { PickedFile } from './upload'
import { DueDatePicker } from './DueDatePicker'
import { DueTimePicker } from './DueTimePicker'
import { phoneZone } from './phoneZone'
import type { Styles } from './styles'
import type { Theme } from './theme'
import { timeZones } from './zones'
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

/**
 * What the form sets: everything about a task but its id and its files. The due time and zone
 * come only when set on a new task, and on an edit only when either changed, then together,
 * `null` for none: an update that leaves both out keeps the task's (#497).
 */
export type TaskValues = Pick<Task, 'description' | 'dueDate' | 'importance' | 'state'> &
  Partial<Pick<Task, 'dueTime' | 'timeZone'>>

/** How many zones the picker lists at once: enough to scroll, few enough to draw at once. */
const ZONES_SHOWN = 30

/** The zones but `chosen` whose name holds `search`, spaces and underscores alike. */
function zonesMatching(search: string, chosen: string) {
  const wanted = search.trim().toLowerCase().replaceAll(' ', '_')
  return timeZones
    .filter((zone) => zone !== chosen && zone.toLowerCase().includes(wanted))
    .slice(0, ZONES_SHOWN)
}

/** A zone as the form shows it: its IANA name, with spaces, as the website's picker shows it. */
function shownZone(zone: string) {
  return zone.replaceAll('_', ' ')
}

/** A task is open or done (#334); `WORKING`, which older apps still send, is not offered. */
const STATES = ['TODO', 'DONE'] as const
type OfferedState = (typeof STATES)[number]

/**
 * Adding a task, or editing one (#271): the description, the due date -- the website's shortcuts,
 * or any day from the platform's calendar -- the importance, an optional time, tied to a time zone
 * or not (#477), and when editing, the state. The time comes after the importance, not beside the
 * date as on the website: on a phone it would push the importance below the keyboard.
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
  // The due time and its zone (#477): none is null; a zone comes only with a time.
  const [dueTime, setDueTime] = useState<string | null>(task?.dueTime ?? null)
  const [timeZone, setTimeZone] = useState<string | null>(task?.timeZone ?? null)
  const [pickingTime, setPickingTime] = useState(false)
  // The zone the switch last held, so turning it off and on again gives a task back its own.
  const [lastZone, setLastZone] = useState(task?.timeZone ?? null)
  const [zoneSearch, setZoneSearch] = useState<string | null>(null)
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
    const timeChanged = dueTime !== (task?.dueTime ?? null) || timeZone !== (task?.timeZone ?? null)
    const values: TaskValues = editing
      ? {
          description: trimmed,
          dueDate,
          importance,
          state,
          ...(timeChanged ? { dueTime, timeZone } : {}),
        }
      : {
          description: trimmed,
          dueDate,
          ...(dueTime === null ? {} : { dueTime }),
          ...(timeZone === null ? {} : { timeZone }),
          importance,
          state,
        }
    if (!(await onSave(values))) {
      setSaving(false)
    }
  }

  const toggleTimePicker = () => setPickingTime(!pickingTime)
  const toggleZoneSearch = () => setZoneSearch(zoneSearch === null ? '' : null)

  /** Ties the time to a zone or lets it float, from the switch or its words. */
  function tieToZone(on: boolean) {
    if (timeZone !== null) {
      setLastZone(timeZone)
    }
    // Off by default, a floating time (Gunnar on #290); on, it starts from the phone's zone.
    setTimeZone(on ? (lastZone ?? phoneZone()) : null)
    setZoneSearch(null)
  }

  /** Clears the time and its zone: a zone says nothing without a time; the backend refuses it. */
  function clearTime() {
    if (timeZone !== null) {
      setLastZone(timeZone)
    }
    setDueTime(null)
    setTimeZone(null)
    setZoneSearch(null)
    setPickingTime(false)
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

          <Text style={styles.label}>{messages.dueTime.label}</Text>
          <View style={styles.chips}>
            {/* Pressed again, it puts iOS's wheels away, which stay while they are turned. */}
            {chip(dueTime ?? messages.dueTime.add, dueTime !== null, toggleTimePicker)}
            {dueTime === null ? null : chip(messages.dueTime.none, false, clearTime)}
          </View>
          {pickingTime ? (
            <DueTimePicker
              value={dueTime}
              onPick={(picked, done) => {
                if (done) {
                  setPickingTime(false)
                }
                if (picked) {
                  setDueTime(picked)
                }
              }}
            />
          ) : null}
          {dueTime === null ? null : (
            <View style={styles.row}>
              <Switch
                testID="zone-switch"
                accessibilityRole="switch"
                accessibilityLabel={messages.dueTime.tied}
                accessibilityState={{ checked: timeZone !== null }}
                value={timeZone !== null}
                // The website's switch: the accent's track when on, the border's when off, and a
                // knob of the page's own colour, where Android would draw its own teal one.
                trackColor={{ true: theme.accent, false: theme.border }}
                thumbColor={theme.bg}
                ios_backgroundColor={theme.border}
                onValueChange={tieToZone}
              />
              {/* Its words turn it too, as the website's label does; only the switch is read. */}
              <Pressable
                testID="zone-switch-label"
                accessible={false}
                importantForAccessibility="no-hide-descendants"
                onPress={() => tieToZone(timeZone === null)}
              >
                <Text style={styles.chipText}>{messages.dueTime.tied}</Text>
              </Pressable>
            </View>
          )}
          {dueTime === null || timeZone === null ? null : (
            <>
              <Text style={styles.label}>{messages.dueTime.zone}</Text>
              <View style={styles.chips}>
                {chip(shownZone(timeZone), true, toggleZoneSearch)}
              </View>
              {zoneSearch === null ? null : (
                <>
                  <TextInput
                    testID="zone-search"
                    style={styles.input}
                    accessibilityLabel={messages.dueTime.search}
                    placeholder={messages.dueTime.search}
                    placeholderTextColor={theme.textMuted}
                    value={zoneSearch}
                    onChangeText={setZoneSearch}
                    autoCorrect={false}
                  />
                  <View style={styles.chips}>
                    {zonesMatching(zoneSearch, timeZone).map((zone) =>
                      chip(shownZone(zone), false, () => {
                        setTimeZone(zone)
                        setZoneSearch(null)
                      }),
                    )}
                  </View>
                </>
              )}
            </>
          )}

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
