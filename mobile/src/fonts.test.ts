import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { font } from './styles'

/** The faces the styles name (#527) are embedded: a missing one would quietly be the system's. */
describe('the app’s fonts', () => {
  const config = readFileSync(join(__dirname, '../app.config.ts'), 'utf8')
  const embedded = config.slice(config.indexOf("'expo-font'"), config.indexOf(']', config.indexOf("'expo-font'")))

  it.each(Object.values(font))('has %s as a file', (name) => {
    expect(existsSync(join(__dirname, `../assets/fonts/${name}.ttf`))).toBe(true)
  })

  it.each(Object.values(font))('embeds %s through expo-font', (name) => {
    expect(embedded).toContain(`'${name}'`)
  })
})
