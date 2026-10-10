import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dark, light, type Theme } from './theme'

/** `surfaceRaised` in the app is `--surface-raised` on the website. */
function cssName(key: string) {
  return `--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

/** The custom properties of the first block in `css` that follows `marker`. */
function propertiesAfter(css: string, marker: string) {
  const start = css.indexOf(marker)
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}

const css = readFileSync(join(__dirname, '../../frontend/src/App.css'), 'utf8')

function expectSameAs(theme: Theme, website: Record<string, string>) {
  for (const [key, value] of Object.entries(theme)) {
    expect([cssName(key), value]).toEqual([cssName(key), website[cssName(key)]])
  }
}

describe('the app’s colours', () => {
  it('are the website’s, light', () => {
    expectSameAs(light, propertiesAfter(css, ':root'))
  })

  it('are the website’s, dark', () => {
    expectSameAs(dark, propertiesAfter(css, 'prefers-color-scheme: dark'))
  })
})
