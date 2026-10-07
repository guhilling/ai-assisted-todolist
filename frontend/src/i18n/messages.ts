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
import type { Language } from './language'

/** The importance levels' words, keyed like the generated `TaskImportance`. */
type ImportanceWords = { LOW: string; MEDIUM: string; HIGH: string }

export const en = {
  app: {
    signOut: 'Sign out',
  },
  sections: {
    overdue: 'Overdue',
    today: 'Today',
    tomorrow: 'Tomorrow',
    thisWeek: 'This week',
    later: 'Later',
  },
  board: {
    loading: 'Loading tasks…',
    empty: 'Nothing here yet. Add your first task.',
    sessionExpired: 'Your session has expired. Sign in again to carry on.',
  },
  /** What the banner says when a failure says nothing for itself, by what was being done. */
  failures: {
    loading: 'Unexpected error while loading data.',
    updating: 'Unexpected error while updating data.',
    deleting: 'Unexpected error while deleting data.',
    restoring: 'Unexpected error while restoring data.',
    saving: 'Unexpected error while saving data.',
  },
  /** The failures `api.ts` names by key (`RequestError`). */
  errors: {
    loadTasks: 'Unable to load tasks from the backend.',
    createTask: 'Unable to create task.',
    updateTask: 'Unable to update task.',
    deleteTask: 'Unable to delete task.',
    unaddressable: 'That task could not be addressed.',
    unexpectedAnswer: 'The backend sent an answer that does not match its own API contract.',
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
    levels: { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } as ImportanceWords,
  },
  row: {
    markDone: (description: string) => `Mark "${description}" as done`,
    actions: (description: string) => `Actions for "${description}"`,
    edit: 'Edit',
    markNotStarted: 'Mark as not started',
    markInProgress: 'Mark as in progress',
    delete: 'Delete',
    inProgress: 'doing',
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
    unexpectedAnswer: 'Das Backend hat eine Antwort geschickt, die nicht zu seinem eigenen API-Vertrag passt.',
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
