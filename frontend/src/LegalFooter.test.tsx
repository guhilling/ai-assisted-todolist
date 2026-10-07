import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LegalFooter from './components/LegalFooter'

describe('the footer outside the app', () => {
  it('speaks English and offers no language it cannot switch to', () => {
    // As the design system's consumers render it: no I18nProvider, so nothing could switch.
    render(<LegalFooter />)

    expect(screen.getByRole('link', { name: 'Imprint' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deutsch' })).not.toBeInTheDocument()
  })
})
