import { ContractBreachError, RequestError } from '../api'
import type { Language } from './language'
import type { Messages } from './messages'

/**
 * What the error banner says about a failure, in the language the app speaks (#203).
 *
 * A failure `api.ts` named -- a request by what it was doing, a broken contract by which answer
 * and how -- is worded from the catalogue. Any other `Error` carries a message in English or in
 * the browser's language, never necessarily the page's: an English page shows it as it is, as
 * before #203, and any other page says the fallback for what was being done instead.
 *
 * @param cause what was caught
 * @param fallback the catalogue's sentence for the operation that failed
 * @param messages the current language's catalogue
 * @param language the current language
 */
export function describeFailure(cause: unknown, fallback: string, messages: Messages, language: Language) {
  if (cause instanceof ContractBreachError) {
    const detail = cause.detail ? messages.contract.details[cause.detail] : undefined
    return messages.contract.message(messages.contract.subjects[cause.subject], detail)
  }
  if (cause instanceof RequestError) {
    return messages.errors[cause.key]
  }
  return language === 'en' && cause instanceof Error ? cause.message : fallback
}
