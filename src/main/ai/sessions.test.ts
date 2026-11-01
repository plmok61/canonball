import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAiAccess } from '../aiAccess'
import { createProject } from '../projectFs'
import { SETTINGS_REL } from '../projectSettings'
import {
  BUILTIN_SESSION_TEMPLATE,
  buildSessionBlock,
  localDate,
  nextLogNumber,
  nextSessionSection,
  sessionLogs
} from './sessions'

const TEMPLATE = path.resolve(__dirname, '../../../template')
const NOW = new Date(2026, 9, 31, 23, 30)
const isProtected = (p: string): boolean => p.startsWith('drafts/')

let tmp: string
let root: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-sess-'))
  root = path.join(tmp, 'project')
  await createProject(root, TEMPLATE)
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const write = (rel: string, text: string): Promise<void> => fs.writeFile(path.join(root, rel), text)

const build = (
  phase: 'brainstorm' | 'end',
  mode: 'tools' | 'fallback' = 'tools'
): Promise<string> =>
  buildSessionBlock({
    access: createAiAccess(root),
    session: { goal: 'Find the ending', phase },
    mode,
    isProtected,
    now: NOW
  })

describe('nextSessionSection', () => {
  it('reads to the next heading', () => {
    expect(
      nextSessionSection('## Next Session\n<!-- x -->\nCall the harbour.\n\n## Other\nNo')
    ).toBe('Call the harbour.')
  })
  it('keeps a deeper heading inside the section', () => {
    expect(nextSessionSection('## Next Session\nA\n### Sub\nB\n## Other\nC')).toBe('A\n### Sub\nB')
  })
  it('works at the end of the file', () => {
    expect(nextSessionSection('# T\n## Next Session\nLast.')).toBe('Last.')
  })
  it('gives an empty string when absent', () => {
    expect(nextSessionSection('## Goals\nx')).toBe('')
  })
  it('caps a long section', () => {
    expect(nextSessionSection('## Next Session\n' + 'a'.repeat(5000)).length).toBe(4000)
  })
})

describe('session logs', () => {
  it('ignores the README and template and sorts numerically', async () => {
    await write('sessions/session-2.md', 'x')
    await write('sessions/session-10.md', 'x')
    await write('sessions/session-9.md', 'x')
    expect(await sessionLogs(createAiAccess(root))).toEqual([
      'sessions/session-2.md',
      'sessions/session-9.md',
      'sessions/session-10.md'
    ])
  })
  it('numbers the next log', () => {
    expect(nextLogNumber([])).toBe(1)
    expect(nextLogNumber(['sessions/session-3.md', 'sessions/2026-05-02.md'])).toBe(4)
  })
  it('formats the local date', () => {
    expect(localDate(NOW)).toBe('2026-10-31')
  })
})

describe('buildSessionBlock', () => {
  it('with no logs there is no previous section and the log is session 1', async () => {
    const block = await build('end')
    expect(block).toContain('sessions/session-1.md')
    expect(block).not.toContain('Where the last session')
  })

  it('includes the previous Next Session', async () => {
    await write('sessions/session-1.md', '## Next Session\nAsk about the lighthouse.')
    const block = await build('brainstorm')
    expect(block).toContain('Where the last session (sessions/session-1.md) said to pick up:')
    expect(block).toContain('Ask about the lighthouse.')
    expect(block).toContain("The writer's goal for this session: Find the ending")
  })

  it('a previous log a version 1 file used to hide is still read', async () => {
    await write('sessions/session-1.md', '## Next Session\nAsk about the lighthouse.')
    await write(
      SETTINGS_REL,
      JSON.stringify({ version: 1, prose: ['drafts'], access: { sessions: 'hidden' } })
    )
    expect(await build('brainstorm')).toContain('Where the last session (sessions/session-1.md)')
  })

  it('tools mode packs canon and notes only', async () => {
    await write('drafts/c.md', 'prose')
    const block = await build('brainstorm')
    expect(block).toContain('The readable canon and notes:')
    expect(block).toContain('<file path="canon/characters.md"')
    expect(block).not.toContain('<file path="memory/')
    expect(block).not.toContain('<file path="outline/')
    expect(block).not.toContain('<file path="drafts/')
    expect(await build('brainstorm', 'fallback')).not.toContain('<file')
  })

  it('the end block carries the stance, goal, path, date and template', async () => {
    const tpl = await fs.readFile(path.join(root, 'sessions/session-template.md'), 'utf8')
    const block = await build('end')
    expect(block).toContain('This is a brainstorm session.')
    expect(block).toContain('suggest a new file at sessions/session-1.md')
    expect(block).toContain('Replace [N] with 1 and [Date] with 2026-10-31')
    expect(block).toContain('create_note')
    expect(block).not.toContain('canonball-create')
    expect(block.split('Template:\n')[1]).toContain(tpl)
    const fb = await build('end', 'fallback')
    expect(fb).toContain('canonball-create')
    expect(fb).not.toContain('create_note')
  })

  it('falls back to the built-in template', async () => {
    await fs.rm(path.join(root, 'sessions/session-template.md'))
    expect(await build('end')).toContain(BUILTIN_SESSION_TEMPLATE)
    expect(BUILTIN_SESSION_TEMPLATE).toBe(
      await fs.readFile(path.join(TEMPLATE, 'sessions/session-template.md'), 'utf8')
    )
  })
})
