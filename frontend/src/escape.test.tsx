/**
 * Escape within an element (#364): it must call the handler the element was last drawn with, the
 * moment it is drawn -- the add row's lock against Escape while its files go up came a moment
 * after the row showed it, and a test pressing Escape in between closed the row now and then.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { useEscapeWithin } from './escape'

const pressed: string[] = []

/** A row locked once `answer` settles, as the add row is once the task is created. */
function Row({ answer }: Readonly<{ answer: Promise<void> }>) {
  const [locked, setLocked] = useState(false)
  useEffect(() => {
    void answer.then(() => setLocked(true))
  }, [answer])
  const form = useRef<HTMLFormElement>(null)
  useEscapeWithin(form, () => pressed.push(locked ? 'while locked' : 'while open'))
  return (
    <form ref={form}>
      <input aria-label="field" disabled={locked} />
    </form>
  )
}

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let actBefore: boolean | undefined
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  pressed.length = 0
  // React as a browser runs it, not as act() would: effects when React gets to them.
  actBefore = actEnvironment.IS_REACT_ACT_ENVIRONMENT
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  root.unmount()
  container.remove()
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = actBefore
})

/** The row's field, once React has drawn it. */
async function fieldOnceDrawn(): Promise<HTMLInputElement> {
  for (;;) {
    const field = container.querySelector('input')
    if (field) {
      return field
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

it('calls the handler the element was last drawn with, as soon as it is drawn', async () => {
  let answered: () => void = () => {}
  const answer = new Promise<void>((resolve) => {
    answered = resolve
  })
  root.render(<Row answer={answer} />)
  const field = await fieldOnceDrawn()

  // Escape pressed the moment the row shows it is locked.
  const pressedOnceShown = new Promise<void>((resolve) => {
    new MutationObserver((_records, observer) => {
      observer.disconnect()
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      resolve()
    }).observe(field, { attributes: true })
  })
  answered()
  await pressedOnceShown

  expect(field.disabled).toBe(true)
  expect(pressed).toEqual(['while locked'])
})
