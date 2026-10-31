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
): Record<'readDoc' | 'writeDoc' | 'onFlushRequest' | 'lintGrammar', Mock> {
  const api = {
    lintGrammar: vi.fn(async (texts: string[]) => texts.map(() => [])),
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
  const { unmount } = render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  unmount()
  await Promise.resolve()
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('flushes pending save on file switch', async () => {
  const api = stub()
  const { rerender } = render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor root="/p" relPath="canon/b.md" isProse={false} />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  expect(api.writeDoc.mock.calls[0][0]).toBe('/p')
  expect(api.writeDoc.mock.calls[0][1]).toBe('canon/a.md')
  expect(api.writeDoc.mock.calls[0][2]).toContain('typed')
})

it('registers a flush handler that saves pending text', async () => {
  const api = stub()
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  act(() => {
    editor.commands.insertContent('typed ')
  })
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  expect(api.writeDoc).toHaveBeenCalledTimes(1)
})

it('shows the draft banner when the file is prose', async () => {
  stub()
  const { rerender } = render(<Editor root="/p" relPath="drafts/ch1.md" isProse={true} />)
  await ready()
  expect(screen.getByText("Draft — AI won't edit")).toBeInTheDocument()
  rerender(<Editor root="/p" relPath="drafts/ch1.md" isProse={false} />)
  await ready()
  expect(screen.queryByText("Draft — AI won't edit")).toBeNull()
})

it('shows path, word count excluding hints, and saved status', async () => {
  stub('<!-- hidden hint words here -->\n\nOne two three\n')
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  await waitFor(() => expect(screen.getByText('3 words')).toBeInTheDocument())
  expect(screen.getByText('canon/a.md')).toBeInTheDocument()
  expect(screen.getByText('saved')).toBeInTheDocument()
})

it('reloads from disk on focus when clean and mtime changed', async () => {
  const api = stub('old text\n', 1)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  expect(document.querySelector('.ProseMirror')).toHaveTextContent('old text')
  api.readDoc.mockResolvedValue({ content: 'new text\n', mtimeMs: 5 })
  fireEvent.focus(window)
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('new text'))
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('does not reload on focus when there are unsaved edits', async () => {
  const api = stub('old text\n', 1)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  expect(await screen.findByText("Couldn't open this file: boom")).toBeInTheDocument()
})

it('shows not saved — retrying when a save fails', async () => {
  const api = stub()
  const editor = await (async () => {
    render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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
  const { rerender } = render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  api.writeDoc.mockRejectedValueOnce(new Error('disk full'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor root="/p" relPath="canon/b.md" isProse={false} />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  await ready()
  const handler = api.onFlushRequest.mock.calls.at(-1)![0] as () => Promise<void>
  await handler()
  const writes = api.writeDoc.mock.calls.filter((c) => c[1] === 'canon/a.md')
  expect(writes.length).toBe(2)
  expect(writes[1][2]).toContain('typed')
})

it('rejects the flush request when an orphaned save still fails', async () => {
  const api = stub()
  const { rerender } = render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  api.writeDoc.mockRejectedValue(new Error('disk full'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor root="/p" relPath="canon/b.md" isProse={false} />)
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
  api.writeDoc.mockImplementation(async (_root: string, p: string, c: string) => {
    disk.set(p, c)
    return { content: c, mtimeMs: 2 }
  })
  return { disk, api }
}

it('reopening a file with a pending orphan save never loses either version (orphan succeeds)', async () => {
  const { disk, api } = diskStub()
  const { rerender } = render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  api.writeDoc.mockRejectedValueOnce(new Error('slow disk'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor root="/p" relPath="canon/b.md" isProse={false} />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  rerender(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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
  const { rerender } = render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  const realWrite = api.writeDoc.getMockImplementation()!
  api.writeDoc.mockRejectedValue(new Error('disk full'))
  act(() => {
    editor.commands.insertContent('typed ')
  })
  rerender(<Editor root="/p" relPath="canon/b.md" isProse={false} />)
  await waitFor(() => expect(api.writeDoc).toHaveBeenCalledTimes(1))
  rerender(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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
  render(<Editor root="/p" relPath="drafts/ch1.md" isProse={false} />)
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
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
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

it('the page is spellchecked and never autocorrected', async () => {
  stub()
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  const pm = document.querySelector('.ProseMirror')
  expect(pm).toHaveAttribute('spellcheck', 'true')
  expect(pm).toHaveAttribute('autocorrect', 'off')
  expect(pm).toHaveAttribute('autocapitalize', 'off')
})

it('hints and raw nodes opt out of spellcheck', async () => {
  stub('<!-- hint -->\n\nText <span>x</span>\n')
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  const nodes = document.querySelectorAll('.cb-hint, .cb-raw')
  expect(nodes.length).toBeGreaterThan(0)
  nodes.forEach((n) => expect(n).toHaveAttribute('spellcheck', 'false'))
})

function flagTheThe(stubApi: ReturnType<typeof stub>): void {
  stubApi.lintGrammar.mockImplementation(async (texts: string[]) =>
    texts.map((t) => {
      const at = t.indexOf('the the')
      return at === -1
        ? []
        : [
            {
              start: at,
              end: at + 7,
              problem: 'the the',
              message: 'Repeated word.',
              kind: 'Repetition',
              suggestions: [{ label: 'the', replacement: 'the' }]
            }
          ]
    })
  )
}

async function underlined(): Promise<Element> {
  return waitFor(
    () => {
      const el = document.querySelector('.cb-grammar')
      if (!el) throw new Error('no underline yet')
      return el
    },
    { timeout: 3000 }
  )
}

it('linting never writes the file', async () => {
  const api = stub('She saw the the cat.\n')
  flagTheThe(api)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  await underlined()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(api.writeDoc).not.toHaveBeenCalled()
})

it('clicking an underline shows the message and fixes; choosing one fixes the text and saves', async () => {
  const api = stub('She saw the the cat.\n')
  flagTheThe(api)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  fireEvent.click(await underlined())
  const dialog = await screen.findByRole('dialog', { name: 'Grammar suggestion' })
  expect(dialog).toHaveTextContent('Repeated word.')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  fireEvent.click(screen.getByRole('button', { name: 'the' }))
  expect(editor.state.doc.textContent).toBe('She saw the cat.')
  expect(screen.queryByRole('dialog')).toBeNull()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(api.writeDoc).toHaveBeenCalledTimes(1)
  expect(api.writeDoc.mock.calls[0][2]).toContain('She saw the cat.')
})

it('right-clicking an underline opens the popover and suppresses the native menu', async () => {
  const api = stub('She saw the the cat.\n')
  flagTheThe(api)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  const el = await underlined()
  const notCancelled = fireEvent.contextMenu(el)
  expect(notCancelled).toBe(false)
  expect(await screen.findByRole('dialog', { name: 'Grammar suggestion' })).toBeInTheDocument()
})

it('right-click on an underline with no fixes leaves the native menu alone', async () => {
  const api = stub('She saw the the cat.\n')
  api.lintGrammar.mockImplementation(async (texts: string[]) =>
    texts.map((t) => {
      const at = t.indexOf('the the')
      return at === -1
        ? []
        : [
            {
              start: at,
              end: at + 7,
              problem: 'the the',
              message: 'Repeated word.',
              kind: 'Repetition',
              suggestions: []
            }
          ]
    })
  )
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  await ready()
  const el = await underlined()
  const notCancelled = fireEvent.contextMenu(el)
  expect(notCancelled).toBe(true)
  await new Promise((r) => setTimeout(r, 10))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('Escape closes the popover without changing the text', async () => {
  const api = stub('She saw the the cat.\n')
  flagTheThe(api)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  fireEvent.click(await underlined())
  await screen.findByRole('dialog')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(editor.state.doc.textContent).toBe('She saw the the cat.')
})

it('Ignore removes the underline', async () => {
  const api = stub('She saw the the cat.\n')
  flagTheThe(api)
  render(<Editor root="/p" relPath="canon/a.md" isProse={false} />)
  const editor = await ready()
  fireEvent.click(await underlined())
  fireEvent.click(await screen.findByRole('button', { name: 'Ignore' }))
  expect(document.querySelector('.cb-grammar')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(editor.state.doc.textContent).toBe('She saw the the cat.')
})
