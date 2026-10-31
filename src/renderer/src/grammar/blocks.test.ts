// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createExtensions } from '../editor/extensions'
import { loadIntoEditor } from '../editor/markdown'
import { collectBlocks, toDocRange } from './blocks'

let editor: Editor | null = null

function load(md: string): Editor {
  editor = new Editor({ extensions: createExtensions() })
  loadIntoEditor(editor, md)
  return editor
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('collectBlocks', () => {
  it('one block per paragraph, heading, list item and table cell; none for code blocks', () => {
    const md = [
      '# Title',
      '',
      'A paragraph.',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '',
      '```',
      'code here',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| c | d |',
      '',
      'After.',
      ''
    ].join('\n')
    const blocks = collectBlocks(load(md).state.doc)
    expect(blocks.map((b) => b.text)).toEqual([
      'Title',
      'A paragraph.',
      'one',
      'two',
      'quoted',
      'a',
      'b',
      'c',
      'd',
      'After.'
    ])
  })

  it('maps offsets across marks and astral characters', () => {
    const ed = load('She **🙂 go** home.\n')
    const [block] = collectBlocks(ed.state.doc)
    expect(block.text).toBe('She 🙂 go home.')
    expect(block.offsets).toHaveLength(block.text.length + 1)
    const start = block.text.indexOf('go')
    const range = toDocRange(block, start, start + 2)
    expect(range).not.toBeNull()
    expect(ed.state.doc.textBetween(range!.from, range!.to)).toBe('go')
  })

  it('masks inline atoms and code', () => {
    const ed = load('Eyes are <!-- decide --> grey and `x` here.\n')
    const [block] = collectBlocks(ed.state.doc)
    expect(block.text).toBe('Eyes are   grey and   here.')
    const comment = block.text.indexOf('are') + 4
    expect(block.masked[comment]).toBe(true)
    expect(toDocRange(block, comment, comment + 1)).toBeNull()
    const x = block.text.indexOf('here') - 2
    expect(block.masked[x]).toBe(true)
    expect(toDocRange(block, x, x + 1)).toBeNull()
    const grey = block.text.indexOf('grey')
    expect(toDocRange(block, grey, grey + 4)).not.toBeNull()
    expect(toDocRange(block, grey, grey)).toBeNull()
  })

  it('hard breaks become newlines', () => {
    const ed = load('one\\\ntwo\n')
    const [block] = collectBlocks(ed.state.doc)
    expect(block.text).toBe('one\ntwo')
    expect(block.masked[3]).toBe(false)
  })
})
