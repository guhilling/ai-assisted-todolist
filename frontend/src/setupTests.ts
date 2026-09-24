import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// React Testing Library only auto-cleans up when Vitest globals are enabled,
// which they are not here, so unmount explicitly to keep tests isolated.
afterEach(cleanup)
