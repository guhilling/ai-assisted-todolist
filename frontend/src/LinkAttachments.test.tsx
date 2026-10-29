/**
 * Links on tasks (#414), as the board shows them: beside the files, by their title, opening their
 * own address in a new tab -- never through a storage link -- and removable like a file. One whose
 * address is no web address is shown but not linked, whatever the backend let through.
 *
 * The row alone, with the board's actions stubbed: how a link gets onto a task is the app's
 * business, and the backend's.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AttachmentActions } from './components/AttachmentList'
import TaskRow from './components/TaskRow'
import { addDays, todayIso } from './dates'

const LINK = {
  id: 9,
  fileName: 'An article worth reading',
  contentType: 'text/uri-list',
  sizeBytes: 0,
  thumbnail: false,
  url: 'https://example.com/articles/42',
}

function actions(): AttachmentActions {
  return { link: vi.fn(), open: vi.fn(), remove: vi.fn(), upload: vi.fn() }
}

function row(attachment: typeof LINK, attachmentActions: AttachmentActions, editable = true) {
  const task = {
    id: 1,
    description: 'Read later',
    dueDate: addDays(todayIso(), 1),
    importance: 'MEDIUM' as const,
    state: editable ? ('TODO' as const) : ('DONE' as const),
    attachments: [attachment],
  }
  render(
    <ul>
      <TaskRow
        task={task}
        today={todayIso()}
        onToggleDone={() => {}}
        onDelete={() => {}}
        onEdit={() => Promise.resolve(true)}
        attachments={attachmentActions}
      />
    </ul>,
  )
  return task
}

describe('a link on a task', () => {
  it('is listed by its title and opens its own address in a new tab, asking for no storage link', () => {
    const board = actions()
    row(LINK, board)

    const link = screen.getByRole('link', { name: 'Open An article worth reading' })
    expect(link).toHaveAttribute('href', 'https://example.com/articles/42')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    fireEvent.click(link)
    expect(board.open).not.toHaveBeenCalled()
    expect(board.link).not.toHaveBeenCalled()
  })

  it('is removed like a file', () => {
    const board = actions()
    const task = row(LINK, board)

    fireEvent.click(screen.getByRole('button', { name: 'Remove An article worth reading' }))

    expect(board.remove).toHaveBeenCalledWith(task, LINK)
  })

  it('is shown, but not linked, when its address is no web address', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'not a url']) {
      row({ ...LINK, url }, actions())

      expect(screen.getByText('An article worth reading')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Open An article worth reading' })).not.toBeInTheDocument()
      cleanup()
    }
  })
})
