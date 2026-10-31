// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Editor as TipTapEditor } from '@tiptap/core'
import { Editor } from './Editor'

// jsdom lacks the layout APIs ProseMirror probes when scrolling/selecting.
beforeAll(() => {
  const rect = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON: () => ({})
  }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator]
    }) as unknown as DOMRectList
  document.elementFromPoint = () => null
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function stub(
  content = 'Hello world\n',
  mtimeMs = 1
): Record<'readDoc' | 'writeDoc' | 'onFlushRequest', Mock> {
  const api = {
    readDoc: vi.fn().mockResolvedValue({ content, mtimeMs }),
    writeDoc: vi.fn().mockResolvedValue({ content: '', mtimeMs: 2 }),
    onFlushRequest: vi.fn()
  }
  ;(window as unknown as { canonball: object }).canonball = api
  return api
}

async function ready(): Promise<TipTapEditor> {
  const dom = await waitFor(() => {
    const el = document.querySelector('.ProseMirror') as
      (HTMLElement & { editor?: TipTapEditor }) | null
    if (!el?.editor || el.getAttribute('contenteditable') !== 'true') throw new Error('not ready')
    return el
  })
  return (dom as HTMLElement & { editor: TipTapEditor }).editor
}

it('does not write when a file is opened and closed without edits', async () => {
  const api = stub()
  const { unmount } = render(<Editor relPath="canon/a.md" />)
  await ready()
  unmount()
  await Promise.resolve()
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('flushes pending save on file switch', async () => {
  const api = stub()
  const { rerender } = render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor relPath="canon/b.md" />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  expect(api.writeDoc.mock.calls[0][0]).toBe('canon/a.md')
  expect(api.writeDoc.mock.calls[0][1]).toContain('typed')
})

it('registers a flush handler that saves pending text', async () => {
  const api = stub()
  render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  act(() => {
    editor.commands.insertContent('typed ')
  })
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  expect(api.writeDoc).toHaveBeenCalledTimes(1)
})

it('shows draft banner only for prose paths', async () => {
  stub()
  const { rerender } = render(<Editor relPath="drafts/ch1.md" />)
  await ready()
  expect(screen.getByText("Draft — AI won't edit")).toBeInTheDocument()
  rerender(<Editor relPath="canon/a.md" />)
  await ready()
  expect(screen.queryByText("Draft — AI won't edit")).toBeNull()
})

it('shows path, word count excluding hints, and saved status', async () => {
  stub('<!-- hidden hint words here -->\n\nOne two three\n')
  render(<Editor relPath="canon/a.md" />)
  await ready()
  await waitFor(() => expect(screen.getByText('3 words')).toBeInTheDocument())
  expect(screen.getByText('canon/a.md')).toBeInTheDocument()
  expect(screen.getByText('saved')).toBeInTheDocument()
})

it('reloads from disk on focus when clean and mtime changed', async () => {
  const api = stub('old text\n', 1)
  render(<Editor relPath="canon/a.md" />)
  await ready()
  expect(document.querySelector('.ProseMirror')).toHaveTextContent('old text')
  api.readDoc.mockResolvedValue({ content: 'new text\n', mtimeMs: 5 })
  fireEvent.focus(window)
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('new text'))
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('does not reload on focus when there are unsaved edits', async () => {
  const api = stub('old text\n', 1)
  render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  act(() => {
    editor.commands.insertContent('mine ')
  })
  api.readDoc.mockResolvedValue({ content: 'new text\n', mtimeMs: 5 })
  fireEvent.focus(window)
  await Promise.resolve()
  expect(document.querySelector('.ProseMirror')).toHaveTextContent('mine')
})
