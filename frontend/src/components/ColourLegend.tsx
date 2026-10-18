import { Fragment } from 'react'
import { useI18n } from '../i18n/context'
import { importanceByRank } from '../importance'


/**
 * What the board's colours mean, above the first board with tasks until dismissed (#335): the
 * importance dots, drawn as the rows draw them, and that a date in red is overdue.
 *
 * One sentence with the dots inline, so it reads aloud as one; the dots themselves are hidden from
 * screen readers, which hear the words. A note, not a landmark: a dismissible hint has no place in
 * the page's landmarks.
 */
function ColourLegend({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  const { messages } = useI18n()
  return (
    <div className="colour-legend" role="note" aria-label={messages.legend.label}>
      <p className="colour-legend-text">
        {messages.importance.label}:
        {/* The words straight in the sentence, not each in an element of its own: the sentence is the text. */}
        {importanceByRank.map((level) => (
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
    </div>
  )
}

export default ColourLegend
