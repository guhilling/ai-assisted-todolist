/**
 * Vitest setup, loaded before every frontend test file.
 *
 * It pulls in the jest-dom matchers and unmounts rendered components after each test.
 * The explicit cleanup is required because React Testing Library only registers its own
 * automatic cleanup when Vitest globals are enabled, and this project does not enable them.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(cleanup)
