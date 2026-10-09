/**
 * Where focus goes when a day is picked in the calendar (#256): back to the calendar button, even
 * when the calendar moves focus into its grid late.
 *
 * react-day-picker's `autoFocus` focuses the selected day in an effect after it renders. When a day
 * is picked before that effect has run -- a quick click, a slow CI machine -- React runs the pending
 * effect before closing the calendar: the day takes the focus the field had just given back, then
 * disappears with the calendar, and focus fell to the page. The App test of the calendar failed on
 * that now and then. Here the late focus is made to happen every time.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import DueDateField from './components/DueDateField'
import { addDays, todayIso } from './dates'

function Field() {
  // From today, like every fixture here: a fixed date would put the calendar in a fixed month.
  const [value, setValue] = useState(addDays(todayIso(), 1))
  return <DueDateField value={value} onChange={setValue} />
}

describe('picking a day', () => {
  it('gives focus back to the calendar button even when the calendar focuses a day late', async () => {
    render(<Field />)
    fireEvent.click(screen.getByRole('button', { name: /choose the due date from a calendar/i }))
    const calendar = await screen.findByRole('grid')
    const selected = calendar.querySelector<HTMLButtonElement>('[aria-selected="true"] button')!
    const day = within(calendar).getAllByRole('button').find((button) => button !== selected && !button.hasAttribute('disabled'))!

    // As the pending autoFocus effect does: React runs it before it removes the calendar, so the
    // day takes the focus straight after the field has given it back to the button.
    const toggle = screen.getByRole('button', { name: /choose the due date from a calendar/i })
    const focusToggle = toggle.focus.bind(toggle)
    toggle.focus = (options?: FocusOptions) => {
      focusToggle(options)
      selected.focus()
    }
    fireEvent.click(day)

    await waitFor(() => expect(screen.queryByRole('grid')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /choose the due date from a calendar/i })).toHaveFocus()
  })
})
