/**
 * A save still on its way while the board changes again (#431): a task's saves go one after
 * another, only the latest one's answer is shown, a failure rolls back to what the server last
 * said, an editor that is saving stays open until the save settles, and a save's answer leaves the
 * files the board already has alone.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorageXhr } from './testing/storage'
import { stubApi, type ApiStub, type StubApiOptions } from './testing/api'
import { ALICE, openMenu, renderSignedIn, rowFor, task } from './testing/board'

/** A PUT the test answers when it chooses, with the task it sent and a status. */
type HeldPut = { sent: Record<string, unknown>; answer: (status: number, body?: unknown) => void }

/** The stubbed backend, but with every PUT held until the test answers it. */
function holdingPuts(options: StubApiOptions) {
  const backend = stubApi(options)
  const held: HeldPut[] = []
  const fetchMock: ApiStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'PUT') {
      return backend(input, init)
    }
    return new Promise<Response>((resolve) => {
      held.push({
        sent: JSON.parse(String(init.body)),
        answer: (status, body) => resolve(new Response(body === undefined ? null : JSON.stringify(body), { status })),
      })
    })
  })
  return { fetchMock, held }
}


/** Lets an answer reach the board before the next is given; a failure takes fewer steps than a success. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 0)))

const checkbox = (description: string) => screen.getByLabelText(`Mark "${description}" as done`)

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a task's saves, one after another", () => {
  it('sends a second tick only once the first has its answer, so the server applies them in order', async () => {
    const { fetchMock, held } = holdingPuts({ me: ALICE, tasks: [task({ id: 51, description: 'Flip flop' })] })
    await renderSignedIn(fetchMock)

    fireEvent.click(checkbox('Flip flop'))
    fireEvent.click(checkbox('Flip flop'))
    await waitFor(() => expect(held).toHaveLength(1))
    expect(checkbox('Flip flop')).not.toBeChecked()

    held[0].answer(200, task({ id: 51, description: 'Flip flop', state: 'DONE' }))
    await waitFor(() => expect(held).toHaveLength(2))
    // The first answer is not shown over the tick that came after it.
    expect(checkbox('Flip flop')).not.toBeChecked()
    held[1].answer(200, task({ id: 51, description: 'Flip flop', state: 'TODO' }))
    await settle()

    expect(held.map((put) => put.sent.state)).toEqual(['DONE', 'TODO'])
    expect(checkbox('Flip flop')).not.toBeChecked()
  })

  it('says nothing of a failed tick that a later one, which went through, replaced', async () => {
    const { fetchMock, held } = holdingPuts({ me: ALICE, tasks: [task({ id: 52, description: 'Ticked thrice' })] })
    await renderSignedIn(fetchMock)

    fireEvent.click(checkbox('Ticked thrice'))
    fireEvent.click(checkbox('Ticked thrice'))
    fireEvent.click(checkbox('Ticked thrice'))
    await waitFor(() => expect(held).toHaveLength(1))

    held[0].answer(500)
    await waitFor(() => expect(held).toHaveLength(2))
    expect(checkbox('Ticked thrice')).toBeChecked()
    held[1].answer(200, task({ id: 52, description: 'Ticked thrice', state: 'TODO' }))
    await waitFor(() => expect(held).toHaveLength(3))
    held[2].answer(200, task({ id: 52, description: 'Ticked thrice', state: 'DONE' }))
    await settle()

    expect(checkbox('Ticked thrice')).toBeChecked()
    expect(screen.queryByText('Unable to update task.')).not.toBeInTheDocument()
  })

  it('rolls a failed tick back to what the server last said, not to a tick that failed too', async () => {
    const { fetchMock, held } = holdingPuts({ me: ALICE, tasks: [task({ id: 55, description: 'Both refused' })] })
    await renderSignedIn(fetchMock)

    fireEvent.click(checkbox('Both refused'))
    fireEvent.click(checkbox('Both refused'))
    await waitFor(() => expect(held).toHaveLength(1))
    held[0].answer(500)
    await waitFor(() => expect(held).toHaveLength(2))
    // The untick was clicked on the tick shown before the server had refused it.
    held[1].answer(500)

    await waitFor(() => expect(screen.getByText('Unable to update task.')).toBeInTheDocument())
    expect(checkbox('Both refused')).not.toBeChecked()
  })
})

describe('an editor that is saving', () => {
  it('stays open, Cancel and Escape included, until the save has an answer', async () => {
    const { fetchMock, held } = holdingPuts({ me: ALICE, tasks: [task({ id: 53, description: 'Slow save' })] })
    await renderSignedIn(fetchMock)
    fireEvent.click(openMenu('Slow save').getByRole('button', { name: 'Edit' }))
    const editor = within(screen.getByRole('form', { name: 'Edit "Slow save"' }))

    fireEvent.click(editor.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(held).toHaveLength(1))

    expect(editor.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(editor.getByLabelText('Description'), { key: 'Escape' })
    expect(screen.getByRole('form', { name: 'Edit "Slow save"' })).toBeInTheDocument()

    held[0].answer(200, task({ id: 53, description: 'Slow save' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit "Slow save"' })).not.toBeInTheDocument())
  })

  it('keeps a file confirmed while the save was on its way', async () => {
    vi.stubGlobal('XMLHttpRequest', StorageXhr)
    const { fetchMock, held } = holdingPuts({
      me: ALICE,
      tasks: [{ ...task({ id: 54, description: 'Filed meanwhile' }), attachments: [] }],
    })
    await renderSignedIn(fetchMock)
    fireEvent.click(openMenu('Filed meanwhile').getByRole('button', { name: 'Edit' }))
    const editor = within(screen.getByRole('form', { name: 'Edit "Filed meanwhile"' }))

    fireEvent.click(editor.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(held).toHaveLength(1))
    fireEvent.change(editor.getByLabelText('choose a file'), {
      target: { files: [new File(['%PDF'], 'Scan.pdf', { type: 'application/pdf' })] },
    })
    await waitFor(() => expect(editor.getByText('Scan.pdf')).toBeInTheDocument())

    // Processed before the file was confirmed, so it lists none.
    held[0].answer(200, { ...task({ id: 54, description: 'Filed meanwhile' }), attachments: [] })

    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit "Filed meanwhile"' })).not.toBeInTheDocument())
    expect(within(rowFor('Filed meanwhile')).getByText('Scan.pdf')).toBeInTheDocument()
  })
})
