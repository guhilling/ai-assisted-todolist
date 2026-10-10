/**
 * Every text the app shows, once per language (#203).
 *
 * English is the source and defines the shape; German must have exactly the same keys, which the
 * `Messages` type makes a compile error rather than a missing word at runtime. A text that depends
 * on a value is a function, so word order and grammar stay the language's own instead of being
 * glued together in a component.
 *
 * The English texts are the ones the app has always shown, word for word: the tests and the
 * browser suites address the UI by them.
 */
import type { AttachmentRefusal, ContractDetail, ContractSubject, RequestErrorKey, TaskImportance } from '../api'
import type { DueBucket } from '../dates'
import type { Language } from './language'

export const en = {
  app: {
    signOut: 'Sign out',
  },
  /** A board section's title, by the bucket it holds; typed by `DueBucket`, so none is missing. */
  sections: {
    overdue: 'Overdue',
    today: 'Today',
    tomorrow: 'Tomorrow',
    thisWeek: 'This week',
    later: 'Later',
  } as Record<DueBucket, string>,
  board: {
    loading: 'Loading tasks…',
    empty: 'Nothing here yet. Add your first task.',
    sessionExpired: 'Your session has expired. Sign in again to carry on.',
    /** The mobile app's, which cannot add a task yet (#271), so does not ask for one. */
    emptyReadOnly: 'Nothing here yet.',
    /** The mobile app's button after a failure. */
    retry: 'Try again',
  },
  /** The mobile app's, when the backend no longer serves its release (#268). */
  update: {
    required: 'This version of the app is too old for TaskFest. Update it to carry on.',
  },
  /** What the banner says when a failure says nothing for itself, by what was being done. */
  failures: {
    loading: 'Unexpected error while loading data.',
    updating: 'Unexpected error while updating data.',
    deleting: 'Unexpected error while deleting data.',
    restoring: 'Unexpected error while restoring data.',
    saving: 'Unexpected error while saving data.',
  },
  /** The failures `api.ts` names by key (`RequestError`), typed by its keys. */
  errors: {
    loadTasks: 'Unable to load tasks from the backend.',
    createTask: 'Unable to create task.',
    updateTask: 'Unable to update task.',
    deleteTask: 'Unable to delete task.',
    unaddressable: 'That task could not be addressed.',
    uploadAttachment: 'Unable to upload the file.',
    openAttachment: 'Unable to open the file.',
    removeAttachment: 'Unable to remove the file.',
    deleteAccount: 'Unable to delete your account.',
  } as Record<RequestErrorKey, string>,
  /** An answer that broke the API contract (`ContractBreachError`): which one, and how. */
  contract: {
    message: (subject: string, detail?: string) =>
      `The backend sent ${subject} that does not match its own API contract` + (detail ? `: ${detail}.` : '.'),
    subjects: {
      task: 'a task',
      taskList: 'a task list',
      signedInUser: 'a signed-in user',
      signInOptions: 'the sign-in options',
      attachment: 'an attachment',
      attachmentLink: 'a link to a file',
    } as Record<ContractSubject, string>,
    details: {
      idNotInteger: 'its id is not an exact integer',
      notArray: 'it is not an array',
    } as Record<ContractDetail, string>,
  },
  addRow: {
    open: 'Add a task',
    description: 'What needs doing',
    placeholder: 'What needs doing?',
    shortcuts: 'Due date shortcuts',
    cancel: 'Cancel',
    add: 'Add',
    adding: 'Adding…',
  },
  editor: {
    label: (description: string) => `Edit "${description}"`,
    description: 'Description',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
  },
  dueDate: {
    label: 'Due date',
    calendar: 'Choose the due date from a calendar',
    loadingCalendar: 'Loading calendar…',
  },
  importance: {
    label: 'Importance',
    levels: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } as Record<TaskImportance, string>,
  },
  row: {
    markDone: (description: string) => `Mark "${description}" as done`,
    actions: (description: string) => `Actions for "${description}"`,
    edit: 'Edit',
    markNotStarted: 'Mark as not started',
    markInProgress: 'Mark as in progress',
    delete: 'Delete',
    inProgress: 'doing',
    /** The mobile app's, for an importance or state newer than the app (#268). */
    unknown: 'Unknown',
  },
  /** Deleting one's own account (#213): the header's button, its confirmation, and the note after. */
  account: {
    delete: 'Delete account',
    title: 'Delete your account?',
    body: 'Every task and every file you have here is deleted, for good. This cannot be undone.',
    typeEmail: 'Type your email address to confirm',
    keep: 'Keep my account',
    confirm: 'Delete my account',
    deleting: 'Deleting…',
    deleted: 'Your account has been deleted. Signing in again starts a new, empty one.',
  },
  /** Files on a task (#204): in the editor, attaching; on the row, opening and removing. */
  attachments: {
    title: 'Attachments',
    drop: 'Drop a PDF or image here, or',
    choose: 'choose a file',
    limits: (megabytes: number, perTask: number, perUser: number) =>
      `PDF or image, up to ${megabytes} MB · ${perTask} per task, ${perUser} in all`,
    full: (perTask: number) => `This task holds the most files it can (${perTask}).`,
    uploading: (fileName: string) => `Uploading ${fileName}`,
    open: (fileName: string) => `Open ${fileName}`,
    remove: (fileName: string) => `Remove ${fileName}`,
    uploadFailed: (fileName: string) => `${fileName} could not be uploaded. Try again.`,
    /** Why a file was refused, by the backend's reason; typed by it, so none is missing. */
    refusals: {
      UNSUPPORTED_TYPE: (fileName: string) => `${fileName} is neither a PDF nor an image.`,
      EMPTY: (fileName: string) => `${fileName} is empty.`,
      TOO_LARGE: (fileName: string) => `${fileName} is larger than the limit.`,
      TASK_FULL: (fileName: string) => `${fileName} was not attached: this task already holds as many files as it can.`,
      USER_FULL: (fileName: string) => `${fileName} was not attached: you already have as many files as you can. Remove one first.`,
      MISMATCH: (fileName: string) => `${fileName} did not arrive as sent and was discarded. Try again.`,
    } as Record<AttachmentRefusal, (fileName: string) => string>,
  },
  completed: {
    title: (count: number) => `Completed (${count})`,
    clear: 'Clear completed',
  },
  undo: {
    deleted: (count: number) => (count === 1 ? 'Task deleted' : `${count} tasks deleted`),
    undo: 'Undo',
    dismiss: 'Dismiss',
  },
  /** The words a due date is described with: `dates.ts`. */
  dates: {
    today: 'Today',
    tomorrow: 'Tomorrow',
    yesterday: 'Yesterday',
    daysAgo: (days: number) => `${days} days ago`,
    inWeeks: (weeks: number) => (weeks === 1 ? 'In 1 week' : `In ${weeks} weeks`),
  },
  signedOut: {
    tagline: 'Your own list, private to whoever signs in.',
    notConfigured: 'Sign-in is not configured for this deployment.',
    signInWith: (provider: string) => `Sign in with ${provider}`,
    /** The mobile app's, when its sign-in in the browser did not complete. */
    failed: 'Signing in did not work. Try again.',
  },
  paused: {
    message: (environment: string | null) =>
      environment ? `Environment ${environment} is paused at the moment.` : 'This environment is paused at the moment.',
    panda: 'A cartoon panda chewing on bamboo',
  },
  footer: {
    about: 'About ↗',
    imprint: 'Imprint',
    privacy: 'Privacy',
    contact: 'Contact:',
    version: (version: string) => `Version ${version}`,
    developmentBuild: 'Development build',
  },
}

/** The shape every language's catalogue has: English's. */
export type Messages = typeof en

export const de: Messages = {
  app: {
    signOut: 'Abmelden',
  },
  sections: {
    overdue: 'Überfällig',
    today: 'Heute',
    tomorrow: 'Morgen',
    thisWeek: 'Diese Woche',
    later: 'Später',
  },
  board: {
    loading: 'Aufgaben werden geladen …',
    empty: 'Noch nichts hier. Leg deine erste Aufgabe an.',
    sessionExpired: 'Deine Sitzung ist abgelaufen. Melde dich wieder an, um weiterzumachen.',
    emptyReadOnly: 'Noch nichts hier.',
    retry: 'Noch einmal versuchen',
  },
  update: {
    required: 'Diese Version der App ist zu alt für TaskFest. Aktualisiere sie, um weiterzumachen.',
  },
  failures: {
    loading: 'Unerwarteter Fehler beim Laden der Daten.',
    updating: 'Unerwarteter Fehler beim Aktualisieren der Daten.',
    deleting: 'Unerwarteter Fehler beim Löschen der Daten.',
    restoring: 'Unerwarteter Fehler beim Wiederherstellen der Daten.',
    saving: 'Unerwarteter Fehler beim Speichern der Daten.',
  },
  errors: {
    loadTasks: 'Die Aufgaben konnten nicht vom Backend geladen werden.',
    createTask: 'Die Aufgabe konnte nicht angelegt werden.',
    updateTask: 'Die Aufgabe konnte nicht geändert werden.',
    deleteTask: 'Die Aufgabe konnte nicht gelöscht werden.',
    unaddressable: 'Diese Aufgabe lässt sich nicht ansprechen.',
    uploadAttachment: 'Die Datei konnte nicht hochgeladen werden.',
    openAttachment: 'Die Datei konnte nicht geöffnet werden.',
    removeAttachment: 'Die Datei konnte nicht entfernt werden.',
    deleteAccount: 'Dein Konto konnte nicht gelöscht werden.',
  },
  contract: {
    message: (subject: string, detail?: string) =>
      `Die Antwort des Backends (${subject}) passt nicht zu seinem eigenen API-Vertrag` + (detail ? `: ${detail}.` : '.'),
    subjects: {
      task: 'eine Aufgabe',
      taskList: 'eine Aufgabenliste',
      signedInUser: 'die angemeldete Person',
      signInOptions: 'die Anmeldeoptionen',
      attachment: 'ein Anhang',
      attachmentLink: 'ein Link zu einer Datei',
    },
    details: {
      idNotInteger: 'ihre ID ist keine exakte Ganzzahl',
      notArray: 'sie ist keine Liste',
    },
  },
  addRow: {
    open: 'Aufgabe hinzufügen',
    description: 'Was ist zu tun',
    placeholder: 'Was ist zu tun?',
    shortcuts: 'Fälligkeit schnell wählen',
    cancel: 'Abbrechen',
    add: 'Hinzufügen',
    adding: 'Wird hinzugefügt …',
  },
  editor: {
    label: (description: string) => `„${description}“ bearbeiten`,
    description: 'Beschreibung',
    cancel: 'Abbrechen',
    save: 'Speichern',
    saving: 'Wird gespeichert …',
  },
  dueDate: {
    label: 'Fällig am',
    calendar: 'Fälligkeitsdatum im Kalender wählen',
    loadingCalendar: 'Kalender wird geladen …',
  },
  importance: {
    label: 'Wichtigkeit',
    levels: { LOW: 'Niedrig', MEDIUM: 'Mittel', HIGH: 'Hoch' },
  },
  row: {
    markDone: (description: string) => `„${description}“ als erledigt markieren`,
    actions: (description: string) => `Aktionen für „${description}“`,
    edit: 'Bearbeiten',
    markNotStarted: 'Als nicht begonnen markieren',
    markInProgress: 'Als in Arbeit markieren',
    delete: 'Löschen',
    inProgress: 'in Arbeit',
    unknown: 'Unbekannt',
  },
  account: {
    delete: 'Konto löschen',
    title: 'Dein Konto löschen?',
    body: 'Alle Aufgaben und alle Dateien, die du hier hast, werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.',
    typeEmail: 'Zur Bestätigung deine E-Mail-Adresse eingeben',
    keep: 'Konto behalten',
    confirm: 'Mein Konto löschen',
    deleting: 'Wird gelöscht …',
    deleted: 'Dein Konto wurde gelöscht. Wenn du dich wieder anmeldest, beginnt ein neues, leeres Konto.',
  },
  attachments: {
    title: 'Anhänge',
    drop: 'PDF oder Bild hierher ziehen oder',
    choose: 'Datei auswählen',
    limits: (megabytes: number, perTask: number, perUser: number) =>
      `PDF oder Bild, bis ${megabytes} MB · ${perTask} pro Aufgabe, ${perUser} insgesamt`,
    full: (perTask: number) => `Diese Aufgabe hat schon so viele Dateien, wie sie haben kann (${perTask}).`,
    uploading: (fileName: string) => `${fileName} wird hochgeladen`,
    open: (fileName: string) => `${fileName} öffnen`,
    remove: (fileName: string) => `${fileName} entfernen`,
    uploadFailed: (fileName: string) => `${fileName} konnte nicht hochgeladen werden. Versuch es noch einmal.`,
    refusals: {
      UNSUPPORTED_TYPE: (fileName: string) => `${fileName} ist weder ein PDF noch ein Bild.`,
      EMPTY: (fileName: string) => `${fileName} ist leer.`,
      TOO_LARGE: (fileName: string) => `${fileName} ist größer als erlaubt.`,
      TASK_FULL: (fileName: string) => `${fileName} wurde nicht angehängt: Diese Aufgabe hat schon so viele Dateien, wie sie haben kann.`,
      USER_FULL: (fileName: string) =>
        `${fileName} wurde nicht angehängt: Du hast schon so viele Dateien, wie du haben kannst. Entferne zuerst eine.`,
      MISMATCH: (fileName: string) =>
        `${fileName} ist nicht so angekommen, wie es gesendet wurde, und wurde verworfen. Versuch es noch einmal.`,
    },
  },
  completed: {
    title: (count: number) => `Erledigt (${count})`,
    clear: 'Erledigte entfernen',
  },
  undo: {
    deleted: (count: number) => (count === 1 ? 'Aufgabe gelöscht' : `${count} Aufgaben gelöscht`),
    undo: 'Rückgängig',
    dismiss: 'Schließen',
  },
  dates: {
    today: 'Heute',
    tomorrow: 'Morgen',
    yesterday: 'Gestern',
    daysAgo: (days: number) => `vor ${days} Tagen`,
    inWeeks: (weeks: number) => (weeks === 1 ? 'In 1 Woche' : `In ${weeks} Wochen`),
  },
  signedOut: {
    tagline: 'Deine eigene Liste – privat für alle, die sich anmelden.',
    notConfigured: 'Für diese Installation ist keine Anmeldung eingerichtet.',
    signInWith: (provider: string) => `Mit ${provider} anmelden`,
    failed: 'Die Anmeldung hat nicht geklappt. Versuch es noch einmal.',
  },
  paused: {
    message: (environment: string | null) =>
      environment ? `Die Umgebung ${environment} ist gerade pausiert.` : 'Diese Umgebung ist gerade pausiert.',
    panda: 'Ein Comic-Panda, der an Bambus kaut',
  },
  footer: {
    about: 'Über das Projekt ↗',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    contact: 'Kontakt:',
    version: (version: string) => `Version ${version}`,
    developmentBuild: 'Entwicklungs-Build',
  },
}

/** Every language's catalogue. */
export const catalogues: Record<Language, Messages> = { en, de }
