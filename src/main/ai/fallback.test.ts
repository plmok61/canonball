import { describe, expect, it } from 'vitest'
import type { AiAccess, AiFile } from '../aiAccess'
import { createBlockFilter, packFiles, type FallbackBlock } from './fallback'

function fakeAccess(files: Record<string, { access: 'edit' | 'read'; content: string }>): AiAccess {
  return {
    list: async (): Promise<AiFile[]> =>
      Object.entries(files)
        .map(([relPath, f]) => ({ relPath, access: f.access }))
        .sort((a, b) => a.relPath.localeCompare(b.relPath)),
    read: async (relPath: string) => ({ relPath, content: files[relPath].content, mtimeMs: 0 })
  } as unknown as AiAccess
}

const isProse = (p: string): boolean => p.startsWith('drafts/')

describe('packFiles', () => {
  it('packs files in priority order within budget', async () => {
    const access = fakeAccess({
      'drafts/ch1.md': { access: 'read', content: 'draft' },
      'zzz/other.md': { access: 'edit', content: 'other' },
      'notes/a.md': { access: 'edit', content: 'note' },
      'canon/c.md': { access: 'edit', content: 'canon' },
      'memory/m.md': { access: 'edit', content: 'mem' },
      'notes/big.md': { access: 'edit', content: 'x'.repeat(30_000) },
      'sessions/s.md': { access: 'edit', content: 'sess' },
      'outline/o.md': { access: 'edit', content: 'out' }
    })
    const out = await packFiles(access, isProse)
    expect(out).not.toContain('memory/m.md')
    const order = [
      'canon/c.md',
      'notes/a.md',
      'outline/o.md',
      'sessions/s.md',
      'zzz/other.md',
      'drafts/ch1.md'
    ]
    const positions = order.map((p) => out.indexOf(`path="${p}"`))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(out).not.toContain('xxxx')
    expect(out.trimEnd().endsWith('Not included (too long to fit): notes/big.md')).toBe(true)
  })

  it('skips a file that does not fit but still includes later small ones', async () => {
    const access = fakeAccess({
      'canon/big.md': { access: 'edit', content: 'x'.repeat(200) },
      'notes/small.md': { access: 'edit', content: 'ok' }
    })
    const out = await packFiles(access, isProse, 100)
    expect(out).toContain('notes/small.md')
    expect(out).toContain('Not included (too long to fit): canon/big.md')
  })

  it('formats files with path and access', async () => {
    const access = fakeAccess({
      'notes/a.md': { access: 'edit', content: 'hello' },
      'drafts/b.md': { access: 'read', content: 'world' }
    })
    const out = await packFiles(access, isProse)
    expect(out).toBe(
      '<file path="notes/a.md" access="edit">\nhello\n</file>\n\n<file path="drafts/b.md" access="read">\nworld\n</file>'
    )
  })
})

function run(chunks: string[]): { text: string; blocks: FallbackBlock[] } {
  const f = createBlockFilter()
  let text = ''
  for (const c of chunks) text += f.push(c)
  const end = f.end()
  return { text: text + end.text, blocks: end.blocks }
}

describe('createBlockFilter', () => {
  it('filters tags split across chunks', () => {
    const r = run([
      'Here: <canon',
      'ball-edit path="notes/a.md"><old>x</old><new>y</n',
      'ew></canonball-edit> Done.'
    ])
    expect(r.text).toBe('Here:  Done.')
    expect(r.blocks).toEqual([
      { kind: 'edit', relPath: 'notes/a.md', edits: [{ old_text: 'x', new_text: 'y' }] }
    ])
  })

  it('parses create blocks and multiple edits in one block', () => {
    const r = run([
      '<canonball-create path="notes/n.md">\nline1\nline2\n</canonball-create>',
      'mid',
      '<canonball-edit path="canon/c.md"><old>\na\n</old><new>b</new>\n<old> two </old><new></new></canonball-edit>'
    ])
    expect(r.text).toBe('mid')
    expect(r.blocks).toEqual([
      { kind: 'create', relPath: 'notes/n.md', content: 'line1\nline2' },
      {
        kind: 'edit',
        relPath: 'canon/c.md',
        edits: [
          { old_text: 'a', new_text: 'b' },
          { old_text: ' two ', new_text: '' }
        ]
      }
    ])
  })

  it('passes ordinary angle brackets through', () => {
    const r = run(['a < b and <em>'])
    expect(r.text).toBe('a < b and <em>')
    expect(r.blocks).toEqual([])
  })

  it('releases a trailing partial prefix at the end', () => {
    expect(run(['go <canonba']).text).toBe('go <canonba')
  })

  it('an unclosed tag becomes invalid and its text stays hidden', () => {
    const r = run(['before <canonball-edit path="notes/a.md"><old>x</old>'])
    expect(r.text).toBe('before ')
    expect(r.blocks).toHaveLength(1)
    expect(r.blocks[0].kind).toBe('invalid')
  })

  it('a missing path is invalid', () => {
    const r = run(['<canonball-edit><old>x</old><new>y</new></canonball-edit>'])
    expect(r.blocks).toEqual([{ kind: 'invalid', reason: 'missing path' }])
    expect(r.text).toBe('')
  })

  it('gives the same result when fed one character at a time', () => {
    const input =
      'Hi <b> a<b <canonball-edit path="notes/a.md"><old>x < y</old><new>z</new></canonball-edit> mid <canonball-create path="notes/n.md">hey</canonball-create> end <'
    const whole = run([input])
    const chars = run(input.split(''))
    expect(chars).toEqual(whole)
    expect(whole.text).toBe('Hi <b> a<b  mid  end <')
    expect(whole.blocks).toHaveLength(2)
  })
})
