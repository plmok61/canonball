import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAiAccess } from '../aiAccess'
import { createProject } from '../projectFs'
import { setPathAccess } from '../projectSettings'
import { createProposalStore } from './proposals'
import { createToolRunner, FILE_TOOLS } from './tools'
import type { ToolCall } from './adapter'
import type { Proposal } from '../../shared/proposals'

const TEMPLATE = path.resolve(__dirname, '../../../template')

let tmp: string
let root: string
let proposals: Proposal[]
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-tools-'))
  root = path.join(tmp, 'project')
  await createProject(root, TEMPLATE)
  await fs.writeFile(path.join(root, 'notes/ideas.md'), 'A tidal city.\nA quiet king.\n')
  await fs.writeFile(path.join(root, 'drafts/ch1.md'), 'The rain kept on.\n')
  proposals = []
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const disk = (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8')
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: 'c1', name, args })

function runner() {
  return createToolRunner({
    root,
    access: createAiAccess(root),
    proposals: createProposalStore(),
    onProposal: (p) => proposals.push(p)
  })
}

describe('file tools', () => {
  it('declares four tools without additionalProperties', () => {
    expect(FILE_TOOLS.map((t) => t.name)).toEqual([
      'list_files',
      'read_file',
      'propose_edit',
      'create_note'
    ])
    expect(JSON.stringify(FILE_TOOLS)).not.toContain('additionalProperties')
  })

  it('list_files shows only visible files with their access', async () => {
    await setPathAccess(root, 'outline', 'hidden')
    const r = await runner().run(call('list_files', {}))
    expect(r.isError).toBe(false)
    expect(r.callId).toBe('c1')
    const lines = r.content.split('\n')
    expect(lines).toContain('notes/ideas.md (can edit)')
    expect(lines).toContain('drafts/ch1.md (read only)')
    expect(r.content).not.toContain('outline/')
  })

  it('list_files says so when nothing is visible', async () => {
    for (const f of ['canon', 'notes', 'outline', 'drafts', 'sessions', 'memory']) {
      await setPathAccess(root, f, 'hidden')
    }
    const r = await runner().run(call('list_files', {}))
    expect(r.content).toBe('No files are visible to you.')
  })

  it('read_file returns content and refuses hidden files', async () => {
    const ok = await runner().run(call('read_file', { path: 'notes/ideas.md' }))
    expect(ok).toMatchObject({ isError: false, content: 'A tidal city.\nA quiet king.\n' })
    await setPathAccess(root, 'notes/ideas.md', 'hidden')
    const bad = await runner().run(call('read_file', { path: 'notes/ideas.md' }))
    expect(bad.isError).toBe(true)
    expect(bad.content.startsWith('Error: ')).toBe(true)
  })

  it('read_file truncates long files', async () => {
    await fs.writeFile(path.join(root, 'notes/long.md'), 'x'.repeat(100_050))
    const r = await runner().run(call('read_file', { path: 'notes/long.md' }))
    expect(r.content).toBe(
      'x'.repeat(100_000) + '\n\n[Truncated: the file is longer than 100000 characters.]'
    )
  })

  it('propose_edit creates a proposal and writes nothing', async () => {
    const r = await runner().run(
      call('propose_edit', {
        path: 'notes/ideas.md',
        edits: [{ old_text: 'quiet', new_text: 'loud' }]
      })
    )
    expect(r).toMatchObject({
      isError: false,
      content:
        'Suggested. The writer will see an Accept/Reject card; nothing changes until they accept.'
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].after).toBe('A tidal city.\nA loud king.\n')
    expect(await disk('notes/ideas.md')).toBe('A tidal city.\nA quiet king.\n')
  })

  it('propose_edit on a draft returns the prose error', async () => {
    const r = await runner().run(
      call('propose_edit', {
        path: 'drafts/ch1.md',
        edits: [{ old_text: 'rain', new_text: 'snow' }]
      })
    )
    expect(r.isError).toBe(true)
    expect(r.content).toBe('Error: Prose is never edited by the AI: drafts/ch1.md')
    expect(proposals).toHaveLength(0)
    expect(await disk('drafts/ch1.md')).toBe('The rain kept on.\n')
  })

  it('propose_edit reports edit problems to the model', async () => {
    const r = await runner().run(
      call('propose_edit', {
        path: 'notes/ideas.md',
        edits: [{ old_text: 'nowhere', new_text: 'x' }]
      })
    )
    expect(r.isError).toBe(true)
    expect(r.content).toContain('old_text not found in notes/ideas.md')
  })

  it('create_note appends .md', async () => {
    const r = await runner().run(call('create_note', { path: 'notes/plot', content: 'Beats.' }))
    expect(r.isError).toBe(false)
    expect(proposals[0]).toMatchObject({
      kind: 'create',
      relPath: 'notes/plot.md',
      after: 'Beats.'
    })
  })

  it('bad arguments become error results', async () => {
    const r = runner()
    const bad: [string, Record<string, unknown>][] = [
      ['read_file', {}],
      ['read_file', { path: 3 }],
      ['propose_edit', { path: 'notes/ideas.md' }],
      ['propose_edit', { path: 'notes/ideas.md', edits: 'x' }],
      ['propose_edit', { path: 'notes/ideas.md', edits: [{ old_text: 1, new_text: 'a' }] }],
      ['propose_edit', { edits: [] }],
      ['create_note', { path: 'notes/a' }],
      ['create_note', { content: 'a' }]
    ]
    for (const [name, args] of bad) {
      const res = await r.run(call(name, args))
      expect(res.isError, name).toBe(true)
      expect(res.content.startsWith(`Error: ${name} needs `), res.content).toBe(true)
    }
    expect(
      (await r.run(call('propose_edit', { path: 'notes/ideas.md', edits: 'x' }))).content
    ).toBe('Error: propose_edit needs edits: a list of { old_text, new_text }')
    expect(proposals).toHaveLength(0)
  })

  it('unknown tools are reported', async () => {
    const r = await runner().run(call('delete_everything', {}))
    expect(r).toMatchObject({ isError: true, content: 'Error: Unknown tool: delete_everything' })
  })

  it('unexpected errors hide details and log without content', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const access = createAiAccess(root)
    access.read = async () => {
      throw new Error('SECRET CONTENT')
    }
    const r = await createToolRunner({
      root,
      access,
      proposals: createProposalStore(),
      onProposal: () => {}
    }).run(call('read_file', { path: 'notes/ideas.md' }))
    expect(r).toMatchObject({
      isError: true,
      content: 'Error: Something went wrong with that file.'
    })
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET')
    spy.mockRestore()
  })
})
