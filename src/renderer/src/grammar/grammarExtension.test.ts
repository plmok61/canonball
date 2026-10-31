// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { undoDepth } from '@tiptap/pm/history'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GrammarLint } from '../../../shared/types'
import { createExtensions } from '../editor/extensions'
import { loadIntoEditor } from '../editor/markdown'
import {
  applyGrammarSuggestion,
  Grammar,
  grammarKey,
  grammarLintAt,
  ignoreGrammarLint,
  type FoundLint
} from './grammarExtension'
import type { DecorationSet } from '@tiptap/pm/view'

let editor: Editor | null = null

afterEach(() => {
  editor?.destroy()
  editor = null
  vi.restoreAllMocks()
})

/** Flags every 'the the' in each text. */
function lintText(text: string): GrammarLint[] {
  const lints: GrammarLint[] = []
  let at = text.indexOf('the the')
  while (at !== -1) {
    lints.push({
      start: at,
      end: at + 7,
      problem: 'the the',
      message: 'Repeated word.',
      kind: 'Repetition',
      suggestions: [{ label: 'Replace with “the”', replacement: 'the' }]
    })
    at = text.indexOf('the the', at + 1)
  }
  return lints
}

type Lint = (texts: string[]) => Promise<GrammarLint[][]>

function fakeLint(): ReturnType<typeof vi.fn<Lint>> {
  return vi.fn<Lint>(async (texts) => texts.map(lintText))
}

function load(md: string, lint: Lint): Editor {
  editor = new Editor({
    extensions: [...createExtensions(), Grammar.configure({ lint, delayMs: 0 })]
  })
  loadIntoEditor(editor, md)
  return editor
}

function decorations(ed: Editor): { from: number; to: number; text: string }[] {
  const set = grammarKey.getState(ed.state) as DecorationSet
  return set
    .find()
    .map((d) => ({ from: d.from, to: d.to, text: ed.state.doc.textBetween(d.from, d.to) }))
}

async function waitForDecorations(ed: Editor, count = 1): Promise<void> {
  await vi.waitFor(() => expect(decorations(ed)).toHaveLength(count))
}

function posOf(ed: Editor, needle: string): number {
  let found = -1
  ed.state.doc.descendants((node, pos) => {
    if (found !== -1) return false
    if (node.isText) {
      const i = node.text!.indexOf(needle)
      if (i !== -1) found = pos + i
    }
    return true
  })
  if (found === -1) throw new Error(`not found: ${needle}`)
  return found
}

function foundAt(ed: Editor, needle: string): FoundLint {
  const found = grammarLintAt(ed.state, posOf(ed, needle) + 1)
  expect(found).not.toBeNull()
  return found!
}

describe('Grammar extension', () => {
  it('underlines the span the linter reports', async () => {
    const ed = load('She went to the the store.\n', fakeLint())
    await waitForDecorations(ed)
    expect(decorations(ed).map((d) => d.text)).toEqual(['the the'])
    const found = foundAt(ed, 'the the')
    expect(found.lint.problem).toBe('the the')
    expect(ed.state.doc.textBetween(found.from, found.to)).toBe('the the')
    expect(grammarLintAt(ed.state, posOf(ed, 'She'))).toBeNull()
  })

  it('decorations never change the document or add undo history', async () => {
    const ed = load('She went to the the store.\n', fakeLint())
    // Loading a file is not an undoable edit.
    expect(undoDepth(ed.state)).toBe(0)
    const before = JSON.stringify(ed.getJSON())
    await waitForDecorations(ed)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
    expect(undoDepth(ed.state)).toBe(0)
  })

  it('only sends paragraphs whose text changed', async () => {
    const lint = fakeLint()
    const ed = load('First one.\n\nSecond the the.\n\nThird one.\n', lint)
    await waitForDecorations(ed)
    expect(lint).toHaveBeenCalledTimes(1)
    expect(lint.mock.calls[0][0]).toHaveLength(3)

    ed.commands.insertContentAt(posOf(ed, 'Second'), 'A ')
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(2))
    expect(lint.mock.calls[1][0]).toEqual(['A Second the the.'])
    await vi.waitFor(() => expect(decorations(ed).map((d) => d.text)).toEqual(['the the']))
  })

  it('never sends empty text', async () => {
    const lint = fakeLint()
    const ed = load('the the\n\n| a | b |\n| - | - |\n|  | d |\n', lint)
    await waitForDecorations(ed)
    for (const [texts] of lint.mock.calls) expect(texts).not.toContain('')
  })

  it('drops results for a document that changed while linting', async () => {
    let release: () => void = () => {}
    const lint = vi.fn<Lint>(
      (texts) =>
        new Promise((resolve) => {
          release = () => resolve(texts.map(lintText))
        })
    )
    const ed = load('She went to the the store.\n', lint)
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(1))
    const firstRelease = release

    // Typing shifts 'the the' right; a stale result would underline the wrong words.
    ed.commands.insertContentAt(posOf(ed, 'She'), 'Then ')
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(2))
    firstRelease()
    await new Promise((r) => setTimeout(r, 10))
    expect(decorations(ed)).toEqual([])

    release()
    await waitForDecorations(ed)
    expect(decorations(ed).map((d) => d.text)).toEqual(['the the'])
  })

  it('a failed lint leaves the document and existing underlines alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lint = fakeLint()
    const ed = load('She went to the the store.\n\nAnother line.\n', lint)
    await waitForDecorations(ed)

    lint.mockRejectedValueOnce(new Error('checker crashed'))
    ed.commands.insertContentAt(posOf(ed, 'line') + 4, ' here')
    const after = JSON.stringify(ed.getJSON())
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1))
    expect(String(warn.mock.calls[0].join(' '))).toContain('checker crashed')
    expect(JSON.stringify(ed.getJSON())).toBe(after)
    expect(decorations(ed).map((d) => d.text)).toEqual(['the the'])
  })

  it('applying a suggestion replaces only the flagged text and can be undone', async () => {
    const ed = load('She went to the the store.\n', fakeLint())
    await waitForDecorations(ed)
    const found = foundAt(ed, 'the the')
    expect(applyGrammarSuggestion(ed, found, 'the')).toBe(true)
    expect(ed.state.doc.textContent).toBe('She went to the store.')
    await vi.waitFor(() => expect(decorations(ed)).toEqual([]))

    ed.commands.undo()
    expect(ed.state.doc.textContent).toBe('She went to the the store.')
  })

  it('an empty replacement deletes the flagged text', async () => {
    const ed = load('She went to the the store.\n', fakeLint())
    await waitForDecorations(ed)
    expect(applyGrammarSuggestion(ed, foundAt(ed, 'the the'), '')).toBe(true)
    expect(ed.state.doc.textContent).toBe('She went to  store.')
  })

  it('apply does nothing when the flagged text has changed', async () => {
    const ed = load('She went to the the store.\n', fakeLint())
    await waitForDecorations(ed)
    const found = foundAt(ed, 'the the')
    ed.commands.insertContentAt(found.from + 1, 'X')
    const before = JSON.stringify(ed.getJSON())
    expect(applyGrammarSuggestion(ed, found, 'the')).toBe(false)
    expect(JSON.stringify(ed.getJSON())).toBe(before)
  })

  it('ignore removes the underline and it stays away after re-linting', async () => {
    const lint = fakeLint()
    const ed = load('She went to the the store.\n\nAnd the the end.\n', lint)
    await waitForDecorations(ed, 2)
    ignoreGrammarLint(ed, foundAt(ed, 'the the'))
    expect(decorations(ed)).toEqual([])

    ed.commands.insertContentAt(posOf(ed, 'end'), 'very ')
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 10))
    expect(decorations(ed)).toEqual([])
    expect(undoDepth(ed.state)).toBe(1)
  })

  it('ignores results that arrive after the editor is destroyed', async () => {
    let release: () => void = () => {}
    const lint = vi.fn<Lint>(
      (texts) =>
        new Promise((resolve) => {
          release = () => resolve(texts.map(lintText))
        })
    )
    const ed = load('She went to the the store.\n', lint)
    await vi.waitFor(() => expect(lint).toHaveBeenCalledTimes(1))
    const dispatch = vi.spyOn(ed.view, 'dispatch')
    ed.destroy()
    editor = null
    release()
    await new Promise((r) => setTimeout(r, 10))
    expect(dispatch).not.toHaveBeenCalled()
  })
})
