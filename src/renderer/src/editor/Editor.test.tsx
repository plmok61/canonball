// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Editor as TipTapEditor } from '@tiptap/core'
import { Editor } from './Editor'
import { __resetSaveRegistryForTests } from './saveRegistry'

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
  vi.useRealTimers()
  cleanup()
  __resetSaveRegistryForTests()
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
  const callsBefore = api.readDoc.mock.calls.length
  fireEvent.focus(window)
  // give any (wrongly) triggered reload time to read and apply
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
  expect(api.readDoc.mock.calls.length).toBe(callsBefore)
  expect(document.querySelector('.ProseMirror')).toHaveTextContent('mine')
  expect(document.querySelector('.ProseMirror')).not.toHaveTextContent('new text')
})

it('does not write when an edit is undone on a file whose round trip normalizes', async () => {
  const api = stub('_em_\n')
  render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const end = editor.state.doc.content.size - 1
  act(() => {
    editor.commands.insertContentAt(end, 'x')
  })
  act(() => {
    editor.commands.deleteRange({ from: end, to: end + 1 })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('shows a message when the file cannot be read', async () => {
  const api = stub()
  api.readDoc.mockRejectedValue(new Error('boom'))
  render(<Editor relPath="canon/a.md" />)
  expect(await screen.findByText("Couldn't open this file: boom")).toBeInTheDocument()
})

it('shows not saved — retrying when a save fails', async () => {
  const api = stub()
  const editor = await (async () => {
    render(<Editor relPath="canon/a.md" />)
    return ready()
  })()
  api.writeDoc.mockRejectedValue(new Error('disk full'))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => {
    editor.commands.insertContent('typed ')
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900)
  })
  expect(screen.getByText('not saved — retrying')).toBeInTheDocument()
  api.writeDoc.mockResolvedValue({ content: '', mtimeMs: 3 })
})

it('retries and succeeds after a failed save', async () => {
  const api = stub()
  render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  api.writeDoc.mockRejectedValueOnce(new Error('disk full'))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => {
    editor.commands.insertContent('typed ')
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(900)
  })
  expect(screen.getByText('not saved — retrying')).toBeInTheDocument()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(screen.getByText('saved')).toBeInTheDocument()
  expect(api.writeDoc).toHaveBeenCalledTimes(2)
})

it('failed save on file switch is retried and flushed on quit', async () => {
  const api = stub()
  const { rerender } = render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  api.writeDoc.mockRejectedValueOnce(new Error('disk full'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor relPath="canon/b.md" />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  await ready()
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  const writes = api.writeDoc.mock.calls.filter((c) => c[0] === 'canon/a.md')
  expect(writes.length).toBe(2)
  expect(writes[1][1]).toContain('typed')
})

it('rejects the flush request when an orphaned save still fails', async () => {
  const api = stub()
  const { rerender } = render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  api.writeDoc.mockRejectedValue(new Error('disk full'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor relPath="canon/b.md" />)
  await ready()
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await expect(handler()).rejects.toThrow('disk full')
  api.writeDoc.mockResolvedValue({ content: '', mtimeMs: 3 })
})

function diskStub(): { disk: Map<string, string>; api: ReturnType<typeof stub> } {
  const api = stub()
  const disk = new Map<string, string>([
    ['canon/a.md', 'Alpha\n'],
    ['canon/b.md', 'Beta\n']
  ])
  api.readDoc.mockImplementation(async (p: string) => ({ content: disk.get(p) ?? '', mtimeMs: 1 }))
  api.writeDoc.mockImplementation(async (p: string, c: string) => {
    disk.set(p, c)
    return { content: c, mtimeMs: 2 }
  })
  return { disk, api }
}

it('reopening a file with a pending orphan save never loses either version (orphan succeeds)', async () => {
  const { disk, api } = diskStub()
  const { rerender } = render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  api.writeDoc.mockRejectedValueOnce(new Error('slow disk'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor relPath="canon/b.md" />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  rerender(<Editor relPath="canon/a.md" />)
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('typed'))
  expect(disk.get('canon/a.md')).toContain('typed')
  // a later edit in the new editor is the final word on disk
  const editor2 = await ready()
  act(() => {
    editor2.commands.insertContent('newer ')
  })
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  expect(disk.get('canon/a.md')).toContain('newer')
  expect(disk.get('canon/a.md')).toContain('typed')
})

it('reopening a file with a pending orphan save never loses either version (orphan still failing)', async () => {
  const { disk, api } = diskStub()
  const { rerender } = render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  const realWrite = api.writeDoc.getMockImplementation()!
  api.writeDoc.mockRejectedValue(new Error('disk full'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor relPath="canon/b.md" />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  rerender(<Editor relPath="canon/a.md" />)
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('typed'))
  const editor2 = await ready()
  act(() => {
    editor2.commands.insertContent('newer ')
  })
  api.writeDoc.mockImplementation(realWrite)
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  expect(disk.get('canon/a.md')).toContain('typed')
  expect(disk.get('canon/a.md')).toContain('newer')
  // exactly one writer: no later write may bring back older text
  const writesAfter = api.writeDoc.mock.calls.length
  await new Promise((r) => setTimeout(r, 50))
  expect(api.writeDoc.mock.calls.length).toBe(writesAfter)
})

it('undo immediately after open neither changes the doc nor writes', async () => {
  const api = stub('# Chapter\n\nShe left.\n')
  render(<Editor relPath="drafts/ch1.md" />)
  const editor = await ready()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => {
    editor.commands.undo()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(document.querySelector('.ProseMirror')).toHaveTextContent('She left.')
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('undo after focus reload does not restore pre-reload text', async () => {
  const api = stub('old text\n', 1)
  render(<Editor relPath="canon/a.md" />)
  const editor = await ready()
  // an edit that is saved, so the editor is clean before the reload
  act(() => {
    editor.commands.insertContent('mine ')
  })
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  expect(api.writeDoc).toHaveBeenCalledTimes(1)
  api.readDoc.mockResolvedValue({ content: 'external text\n', mtimeMs: 5 })
  fireEvent.focus(window)
  await waitFor(() =>
    expect(document.querySelector('.ProseMirror')).toHaveTextContent('external text')
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  act(() => {
    editor.commands.undo()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(document.querySelector('.ProseMirror')).toHaveTextContent('external text')
  expect(document.querySelector('.ProseMirror')).not.toHaveTextContent('mine')
  expect(api.writeDoc).toHaveBeenCalledTimes(1)
})
