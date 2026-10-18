import { Fragment } from 'react'
import { useI18n } from '../i18n/context'
import { importanceRank } from '../importance'
import type { TaskImportance } from '../api'

const LEVELS = (Object.keys(importanceRank) as TaskImportance[]).sort((a, b) => importanceRank[b] - importanceRank[a])

/**
 * What the board's colours mean, above the first board with tasks until dismissed (#335): the
 * importance dots, drawn as the rows draw them, and that a date in red is overdue.
 *
 * One sentence with the dots inline, so it reads aloud as one; the dots themselves are hidden from
 * screen readers, which hear the words.
 */
function ColourLegend({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  const { messages } = useI18n()
  return (
    <aside className="colour-legend" aria-label={messages.legend.label}>
      <p className="colour-legend-text">
        {messages.importance.label}:
        {/* The words straight in the sentence, not each in an element of its own: the sentence is the text. */}
        {LEVELS.map((level) => (
          <Fragment key={level}>
            {' '}
            <span className={`task-importance task-importance--${level.toLowerCase()}`} aria-hidden="true" />{' '}
            {messages.importance.levels[level]}
          </Fragment>
        ))}
        . {messages.legend.overdue}
      </p>
      <button type="button" className="button-quiet" onClick={onDismiss}>
        {messages.legend.dismiss}
      </button>
    </aside>
  )
}

export default ColourLegend
