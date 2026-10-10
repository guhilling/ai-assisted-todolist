import type { Language } from './web'

/**
 * The few texts only the app shows, in every language the website speaks.
 *
 * Everything the app shares with the website comes from the website's catalogue, through
 * `web.ts`. These stay here because that catalogue holds only what the website uses, and its own
 * test says so. English defines the shape; German must match it, as on the website.
 */
const en = {
  signInFailed: 'Signing in did not work. Try again.',
  tryAgain: 'Try again',
  emptyBoard: 'Nothing here yet.',
  updateRequired: 'This version of the app is too old for TaskFest. Update it to carry on.',
  unknownValue: 'Unknown',
}

/** The shape every language's texts have: English's. */
export type AppMessages = typeof en

const de: AppMessages = {
  signInFailed: 'Die Anmeldung hat nicht geklappt. Versuch es noch einmal.',
  tryAgain: 'Noch einmal versuchen',
  emptyBoard: 'Noch nichts hier.',
  updateRequired: 'Diese Version der App ist zu alt für TaskFest. Aktualisiere sie, um weiterzumachen.',
  unknownValue: 'Unbekannt',
}

/** The app's own texts, by language. */
export const appCatalogues: Record<Language, AppMessages> = { en, de }
