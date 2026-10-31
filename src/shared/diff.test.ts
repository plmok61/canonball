import { describe, expect, it } from 'vitest'
import { collapseDiff, diffLines } from './diff'

describe('diffLines', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' }
    ])
  })

  it('create diffs as all added', () => {
    expect(diffLines('', 'x\ny')).toEqual([
      { kind: 'add', text: 'x' },
      { kind: 'add', text: 'y' }
    ])
  })

  it('handles insertions in the middle with LCS', () => {
    const kinds = diffLines('a\nb\nc\nd', 'a\nc\nx\nd').map((l) => l.kind + ':' + l.text)
    expect(kinds).toEqual(['same:a', 'del:b', 'same:c', 'add:x', 'same:d'])
  })
})

describe('collapseDiff', () => {
  it('collapses long unchanged runs', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`)
    const after = [...before]
    after[10] = 'CHANGED'
    const rows = collapseDiff(diffLines(before.join('\n'), after.join('\n')))
    expect(rows.map((r) => (r.kind === 'gap' ? '…' : r.kind + ':' + r.text))).toEqual([
      '…',
      'same:l8',
      'same:l9',
      'del:l10',
      'add:CHANGED',
      'same:l11',
      'same:l12',
      '…'
    ])
  })
})
