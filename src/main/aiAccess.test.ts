import { existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccessDenied, createAiAccess } from './aiAccess'
import { createProject } from './projectFs'
import { SETTINGS_REL, setPathAccess } from './projectSettings'

const TEMPLATE = path.resolve(__dirname, '../../template')
const CHAPTER = 'drafts/chapters/c.md'
const CHAPTER_TEXT = 'The rain kept on.\n'

let tmp: string
let root: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-ai-'))
  root = path.join(tmp, 'project')
  await createProject(root, TEMPLATE)
  await fs.writeFile(path.join(root, CHAPTER), CHAPTER_TEXT)
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const disk = (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8')
const writeSettings = (text: string): Promise<void> =>
  fs.writeFile(path.join(root, SETTINGS_REL), text)

async function denied(p: Promise<unknown>, message: RegExp): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(err).toBeInstanceOf(AccessDenied)
  expect((err as Error).name).toBe('AccessDenied')
  expect((err as Error).message).toMatch(message)
}

describe('AI access layer', () => {
  it('refuses prose writes however the path is spelled', async () => {
    await fs.symlink('../drafts', path.join(root, 'canon/link'))
    const ai = createAiAccess(root)
    const spellings = [
      CHAPTER,
      'drafts/../drafts/chapters/c.md',
      './drafts/chapters/c.md',
      'canon/link/chapters/c.md'
    ]
    // Only meaningful on a case-insensitive disk (the macOS default).
    if (existsSync(path.join(root, 'DRAFTS'))) spellings.push('DRAFTS/Chapters/C.md')
    for (const p of spellings) {
      await denied(ai.write(p, 'AI text'), /Prose is never edited/)
    }
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
  })

  it('canonicalize returns the real on-disk path', async () => {
    await fs.symlink('../drafts', path.join(root, 'canon/link'))
    const ai = createAiAccess(root)
    expect(ai.canonicalize('canon/link/chapters/c.md')).toBe(CHAPTER)
    expect(ai.canonicalize('./notes/../notes/new.md')).toBe('notes/new.md')
    expect(() => ai.canonicalize('../outside.md')).toThrow(AccessDenied)
  })

  it('refuses a hand-edited edit override in a prose folder', async () => {
    const s = JSON.parse(await disk(SETTINGS_REL))
    s.access[CHAPTER] = 'edit'
    await writeSettings(JSON.stringify(s))
    const ai = createAiAccess(root)
    await denied(ai.write(CHAPTER, 'AI text'), /Prose is never edited/)
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
  })

  it('refuses creating files in prose', async () => {
    const ai = createAiAccess(root)
    await denied(ai.create('drafts/chapters/new.md', 'x'), /Prose is never edited/)
    expect(existsSync(path.join(root, 'drafts/chapters/new.md'))).toBe(false)
  })

  it('writes and creates where allowed', async () => {
    const ai = createAiAccess(root)
    const w = await ai.write('canon/characters.md', 'x')
    expect(w.content).toBe('x')
    expect(await disk('canon/characters.md')).toBe('x')
    await ai.create('notes/idea.md', 'y')
    expect(await disk('notes/idea.md')).toBe('y')
    await denied(ai.create('notes/idea.md', 'z'), /File already exists/)
    expect(await disk('notes/idea.md')).toBe('y')
  })

  it('write needs an existing file and create needs an existing folder', async () => {
    const ai = createAiAccess(root)
    await denied(ai.write('canon/missing.md', 'x'), /Not available to the AI/)
    await denied(ai.create('notes/sub/new.md', 'x'), /Not available to the AI/)
    expect(existsSync(path.join(root, 'canon/missing.md'))).toBe(false)
    expect(existsSync(path.join(root, 'notes/sub'))).toBe(false)
  })

  it('read-only and hidden are enforced', async () => {
    const ai = createAiAccess(root)
    const before = await disk('outline/outline.md')
    await denied(ai.write('outline/outline.md', 'x'), /may only read/)
    expect(await disk('outline/outline.md')).toBe(before)
    expect((await ai.read('memory/style_rules.md')).content).toBe(
      await disk('memory/style_rules.md')
    )
    await setPathAccess(root, 'memory', 'hidden')
    await denied(ai.read('memory/style_rules.md'), /hidden/)
    const list = await ai.list()
    expect(list.some((f) => f.relPath.startsWith('memory/'))).toBe(false)
  })

  it('file-level edit in a read folder allows editing that file only', async () => {
    await setPathAccess(root, 'outline/outline.md', 'edit')
    const ai = createAiAccess(root)
    await ai.write('outline/outline.md', 'x')
    expect(await disk('outline/outline.md')).toBe('x')
    await denied(ai.create('outline/new.md', 'y'), /may not create files in this folder: outline/)
    await denied(
      ai.create('top.md', 'y'),
      /may not create files in this folder: the project's top level/
    )
    expect(existsSync(path.join(root, 'outline/new.md'))).toBe(false)
  })

  it('dot-paths and non-markdown are never available', async () => {
    const ai = createAiAccess(root)
    await denied(ai.read('.canonball/project.json'), /Not available to the AI/)
    await denied(ai.write('.gitignore', 'x'), /Not available to the AI/)
    await denied(ai.create('canon/x.txt', 'x'), /Not available to the AI/)
    await denied(ai.read('../outside.md'), /Not available to the AI/)
    expect(existsSync(path.join(root, 'canon/x.txt'))).toBe(false)
  })

  it('an unreadable settings file grants no writes', async () => {
    await writeSettings('{oops')
    const ai = createAiAccess(root)
    const before = await disk('canon/characters.md')
    await denied(ai.write('canon/characters.md', 'x'), /Project settings file is unreadable/)
    await denied(ai.create('notes/idea.md', 'x'), /Project settings file is unreadable/)
    expect(await disk('canon/characters.md')).toBe(before)
    expect(existsSync(path.join(root, 'notes/idea.md'))).toBe(false)
  })

  it('an unreadable settings file hides everything', async () => {
    await writeSettings('{oops')
    const ai = createAiAccess(root)
    expect(await ai.list()).toEqual([])
    await denied(ai.read('canon/characters.md'), /Project settings file is unreadable/)
    await denied(ai.read(CHAPTER), /Project settings file is unreadable/)
  })

  it('list reports access per file', async () => {
    const ai = createAiAccess(root)
    const list = await ai.list()
    expect(list.find((f) => f.relPath === 'canon/characters.md')?.access).toBe('edit')
    expect(list.find((f) => f.relPath === CHAPTER)?.access).toBe('read')
    expect(list.some((f) => f.relPath.startsWith('.canonball'))).toBe(false)
    const paths = list.map((f) => f.relPath)
    expect(paths).toEqual([...paths].sort())
  })
})
