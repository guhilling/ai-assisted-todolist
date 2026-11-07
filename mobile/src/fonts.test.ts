import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fontFiles } from './fonts'

/** The faces the styles name (#527) are all there: a missing one would quietly be the system's. */
describe('the app’s fonts', () => {
  it.each(fontFiles)('has %s', (file) => {
    expect(existsSync(join(__dirname, '..', file))).toBe(true)
  })
})
