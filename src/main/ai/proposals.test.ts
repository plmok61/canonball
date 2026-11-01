import { existsSync, promises as fs, statSync } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHANGED_SINCE_PROPOSAL, EXPIRED_PROPOSAL } from '../../shared/proposals'
import { AccessDenied, createAiAccess } from '../aiAccess'
import { createProject } from '../projectFs'
import { setProsePaths } from '../projectSettings'
import { applyEdits, createProposalStore, ProposalError } from './proposals'

const TEMPLATE = path.resolve(__dirname, '../../../template')

let tmp: string
let root: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-prop-'))
  root = path.join(tmp, 'project')
  await createProject(root, TEMPLATE)
  await fs.writeFile(path.join(root, 'notes/ideas.md'), 'A fox.\nA hen.\n')
  await fs.writeFile(path.join(root, 'drafts/ch1.md'), 'Once upon a time.\n')
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const disk = (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8')
const swap = [{ old_text: 'A fox.', new_text: 'A wolf.' }]

describe('applyEdits', () => {
  it('replaces unique text', () => {
    const out = applyEdits(
      'one two three',
      [
        { old_text: 'one', new_text: '1' },
        { old_text: 'three', new_text: '3' }
      ],
      'a.md'
    )
    expect(out).toBe('1 two 3')
  })

  it('reports text that is not found', () => {
    const run = (): string => applyEdits('abc', [{ old_text: 'zzz', new_text: 'y' }], 'a.md')
    expect(run).toThrow(ProposalError)
    expect(run).toThrow('old_text not found in a.md: "zzz"')
  })

  it('reports text that appears more than once', () => {
    expect(() => applyEdits('aa aa', [{ old_text: 'aa', new_text: 'b' }], 'a.md')).toThrow(
      'old_text appears 2 times in a.md; include more surrounding text'
    )
  })

  it('reports overlapping edits', () => {
    expect(() =>
      applyEdits(
        'abcdef',
        [
          { old_text: 'abcd', new_text: 'x' },
          { old_text: 'cdef', new_text: 'y' }
        ],
        'a.md'
      )
    ).toThrow('Edits overlap in a.md')
  })
})

describe('proposal store', () => {
  it('proposing writes nothing', async () => {
    const store = createProposalStore()
    const ai = createAiAccess(root)
    const file = path.join(root, 'notes/ideas.md')
    const mtime = statSync(file).mtimeMs
    const edit = await store.proposeEdit(root, ai, 'notes/ideas.md', swap)
    const made = await store.proposeCreate(root, ai, 'notes/new.md', 'hello')
    expect(edit).toMatchObject({ kind: 'edit', status: 'pending', after: 'A wolf.\nA hen.\n' })
    expect(made).toMatchObject({ kind: 'create', relPath: 'notes/new.md', before: '' })
    expect(await disk('notes/ideas.md')).toBe('A fox.\nA hen.\n')
    expect(statSync(file).mtimeMs).toBe(mtime)
    expect(existsSync(path.join(root, 'notes/new.md'))).toBe(false)
  })

  it('refuses edits to prose', async () => {
    const store = createProposalStore()
    const err = await store
      .proposeEdit(root, createAiAccess(root), 'drafts/ch1.md', [
        { old_text: 'Once', new_text: 'Twice' }
      ])
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AccessDenied)
    expect((err as Error).message).toBe('Prose is never edited by the AI: drafts/ch1.md')
  })

  it('refuses an edit that changes nothing', async () => {
    const store = createProposalStore()
    await expect(
      store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', [
        { old_text: 'A fox.', new_text: 'A fox.' }
      ])
    ).rejects.toThrow("That edit doesn't change notes/ideas.md")
  })

  it('accept writes the edit', async () => {
    const store = createProposalStore()
    const p = await store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', swap)
    expect(await store.apply(root, p.id)).toEqual({ relPath: 'notes/ideas.md' })
    expect(await disk('notes/ideas.md')).toBe(p.after)
  })

  it('accept creates the new file', async () => {
    const store = createProposalStore()
    const p = await store.proposeCreate(root, createAiAccess(root), 'notes/new.md', 'hello')
    await store.apply(root, p.id)
    expect(await disk('notes/new.md')).toBe('hello')
  })

  it('refuses when the file changed since the proposal', async () => {
    const store = createProposalStore()
    const p = await store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', swap)
    await fs.writeFile(path.join(root, 'notes/ideas.md'), 'My own text.\n')
    await expect(store.apply(root, p.id)).rejects.toThrow(CHANGED_SINCE_PROPOSAL)
    expect(await disk('notes/ideas.md')).toBe('My own text.\n')
    // Still held, so Reject works and a second Accept says the same.
    await expect(store.apply(root, p.id)).rejects.toThrow(CHANGED_SINCE_PROPOSAL)
  })

  it('accept is refused if the folder became prose', async () => {
    const store = createProposalStore()
    const p = await store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', swap)
    await setProsePaths(root, ['drafts', 'notes'])
    await expect(store.apply(root, p.id)).rejects.toThrow(/Prose is never edited/)
    expect(await disk('notes/ideas.md')).toBe('A fox.\nA hen.\n')
    await expect(store.apply(root, p.id)).rejects.toThrow(EXPIRED_PROPOSAL)
  })

  it('unknown proposal ids fail with the expired copy', async () => {
    const store = createProposalStore()
    await expect(store.apply(root, 'nope')).rejects.toThrow(EXPIRED_PROPOSAL)
    const p = await store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', swap)
    await expect(store.apply(path.join(tmp, 'other'), p.id)).rejects.toThrow(EXPIRED_PROPOSAL)
  })

  it('reject forgets the proposal', async () => {
    const store = createProposalStore()
    const p = await store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', swap)
    store.reject(p.id)
    store.reject('unknown')
    await expect(store.apply(root, p.id)).rejects.toThrow(EXPIRED_PROPOSAL)
    expect(await disk('notes/ideas.md')).toBe('A fox.\nA hen.\n')
  })

  it('clear forgets everything', async () => {
    const store = createProposalStore()
    const a = await store.proposeEdit(root, createAiAccess(root), 'notes/ideas.md', swap)
    const b = await store.proposeCreate(root, createAiAccess(root), 'notes/n.md', 'x')
    store.clear()
    await expect(store.apply(root, a.id)).rejects.toThrow(EXPIRED_PROPOSAL)
    await expect(store.apply(root, b.id)).rejects.toThrow(EXPIRED_PROPOSAL)
  })
})
