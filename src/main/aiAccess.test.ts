import { existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccessDenied, createAiAccess } from './aiAccess'
import { createProject } from './projectFs'
import { SETTINGS_REL, setProtectedPaths } from './projectSettings'

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
  it('refuses protected writes however the path is spelled', async () => {
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
      await denied(ai.write(p, 'AI text'), /Protected files are never edited/)
    }
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
  })

  it('refuses protected writes through a differently normalized folder name', async () => {
    const nfc = 'Entw\u00fcrfe'
    const nfd = nfc.normalize('NFD')
    await fs.mkdir(path.join(root, nfc))
    await fs.writeFile(path.join(root, nfc, 'c.md'), CHAPTER_TEXT)
    await setProtectedPaths(root, ['drafts', nfc])
    const ai = createAiAccess(root)
    await denied(ai.write(`${nfc}/c.md`, 'AI text'), /Protected files are never edited/)
    // A normalization-insensitive disk (the macOS default) finds the folder
    // under either spelling; elsewhere the NFD spelling simply doesn't exist.
    await denied(
      ai.write(`${nfd}/c.md`, 'AI text'),
      existsSync(path.join(root, nfd))
        ? /Protected files are never edited/
        : /Not available to the AI/
    )
    expect(await disk(`${nfc}/c.md`)).toBe(CHAPTER_TEXT)
  })

  it('refuses protected writes with a trailing slash', async () => {
    const ai = createAiAccess(root)
    await denied(ai.write(`${CHAPTER}/`, 'AI text'), /Protected files are never edited/)
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
  })

  it('refuses protected writes through a file-level symlink', async () => {
    await fs.symlink('../drafts/chapters/c.md', path.join(root, 'canon/c.md'))
    const ai = createAiAccess(root)
    await denied(ai.write('canon/c.md', 'AI text'), /Protected files are never edited/)
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
  })

  it('refuses creating a protected file through a dangling symlink', async () => {
    await fs.symlink('../drafts/chapters/new.md', path.join(root, 'canon/new.md'))
    const ai = createAiAccess(root)
    // The link itself occupies the name, so the exclusive create refuses it.
    await denied(ai.create('canon/new.md', 'AI text'), /File already exists/)
    expect(existsSync(path.join(root, 'drafts/chapters/new.md'))).toBe(false)
  })

  it('canonicalize returns the real on-disk path', async () => {
    await fs.symlink('../drafts', path.join(root, 'canon/link'))
    const ai = createAiAccess(root)
    expect(ai.canonicalize('canon/link/chapters/c.md')).toBe(CHAPTER)
    expect(ai.canonicalize('./notes/../notes/new.md')).toBe('notes/new.md')
    expect(() => ai.canonicalize('../outside.md')).toThrow(AccessDenied)
  })

  it('a version 1 edit override never unlocks a protected file', async () => {
    await writeSettings(
      JSON.stringify({ version: 1, prose: ['drafts'], access: { [CHAPTER]: 'edit' } })
    )
    const ai = createAiAccess(root)
    await denied(ai.write(CHAPTER, 'AI text'), /Protected files are never edited/)
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
  })

  it('refuses creating files in a protected folder', async () => {
    const ai = createAiAccess(root)
    await denied(ai.create('drafts/chapters/new.md', 'x'), /Protected files are never edited/)
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

  it('reads a file under a former hidden entry', async () => {
    await fs.writeFile(path.join(root, 'notes/a.md'), 'secret?')
    await writeSettings(
      JSON.stringify({ version: 1, prose: ['drafts'], access: { notes: 'hidden' } })
    )
    const ai = createAiAccess(root)
    expect((await ai.read('notes/a.md')).content).toBe('secret?')
    expect((await ai.list()).some((f) => f.relPath === 'notes/a.md')).toBe(true)
  })

  it('reads a protected file', async () => {
    const ai = createAiAccess(root)
    expect((await ai.read(CHAPTER)).content).toBe(CHAPTER_TEXT)
  })

  it('writes outline/ which used to be read-only', async () => {
    await fs.writeFile(path.join(root, 'outline/a.md'), 'old')
    const ai = createAiAccess(root)
    await ai.write('outline/a.md', 'x')
    expect(await disk('outline/a.md')).toBe('x')
  })

  it('creates at the top level', async () => {
    const ai = createAiAccess(root)
    await ai.create('new.md', 'x')
    expect(await disk('new.md')).toBe('x')
  })

  it('refuses a create under a protected entry missing on disk', async () => {
    await setProtectedPaths(root, ['gone'])
    const ai = createAiAccess(root)
    await denied(ai.checkCreate('gone/x.md'), /./)
    // Refused because it is protected, not merely because the folder is missing.
    await fs.mkdir(path.join(root, 'gone'))
    await denied(
      ai.checkCreate('gone/x.md'),
      /Protected files are never edited by the AI: gone\/x\.md/
    )
    await denied(ai.create('gone/x.md', 'x'), /Protected files are never edited/)
    expect(existsSync(path.join(root, 'gone/x.md'))).toBe(false)
  })

  it('a protected single file is refused but its siblings are not', async () => {
    await setProtectedPaths(root, ['canon/world.md'])
    const ai = createAiAccess(root)
    await denied(ai.write('canon/world.md', 'x'), /Protected files are never edited/)
    await ai.write('canon/themes.md', 'y')
    expect(await disk('canon/themes.md')).toBe('y')
    // The template's drafts are no longer protected once the writer drops them.
    await ai.write(CHAPTER, 'z')
    expect(await disk(CHAPTER)).toBe('z')
  })

  it('dot-paths and non-markdown are never available', async () => {
    const ai = createAiAccess(root)
    await denied(ai.read('.canonball/project.json'), /Not available to the AI/)
    await denied(ai.write('.gitignore', 'x'), /Not available to the AI/)
    await denied(ai.create('canon/x.txt', 'x'), /Not available to the AI/)
    await denied(ai.read('../outside.md'), /Not available to the AI/)
    expect(existsSync(path.join(root, 'canon/x.txt'))).toBe(false)
  })

  it('unreadable settings refuse writes but allow reads', async () => {
    await writeSettings('{oops')
    const ai = createAiAccess(root)
    const before = await disk('canon/characters.md')
    await denied(ai.write('canon/characters.md', 'x'), /Project settings file is unreadable/)
    await denied(ai.create('notes/idea.md', 'x'), /Project settings file is unreadable/)
    await denied(ai.checkWrite('canon/characters.md'), /Project settings file is unreadable/)
    await denied(ai.checkCreate('notes/idea.md'), /Project settings file is unreadable/)
    expect(await disk('canon/characters.md')).toBe(before)
    expect(existsSync(path.join(root, 'notes/idea.md'))).toBe(false)
    expect((await ai.read('canon/characters.md')).content).toBe(before)
    expect((await ai.read(CHAPTER)).content).toBe(CHAPTER_TEXT)
  })

  it('unreadable settings list every file as protected', async () => {
    await writeSettings('{oops')
    const ai = createAiAccess(root)
    const list = await ai.list()
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((f) => f.protected)).toBe(true)
    expect(list.some((f) => f.relPath === 'canon/characters.md')).toBe(true)
  })

  it('list marks protected files', async () => {
    await fs.writeFile(path.join(root, 'drafts/ch1.md'), 'one')
    await fs.writeFile(path.join(root, 'canon/a.md'), 'a')
    await setProtectedPaths(root, ['drafts'])
    const ai = createAiAccess(root)
    const list = await ai.list()
    expect(list).toContainEqual({ relPath: 'drafts/ch1.md', protected: true })
    expect(list).toContainEqual({ relPath: 'canon/a.md', protected: false })
    expect(list.some((f) => f.relPath.startsWith('.canonball'))).toBe(false)
    const paths = list.map((f) => f.relPath)
    expect(paths).toEqual([...paths].sort())
  })

  it('checkWrite and checkCreate refuse what write and create refuse', async () => {
    await fs.writeFile(path.join(root, 'notes/ideas.md'), 'idea')
    await setProtectedPaths(root, ['drafts', 'canon/world.md'])
    const ai = createAiAccess(root)
    await denied(ai.checkWrite(CHAPTER), /Protected files are never edited/)
    await denied(ai.checkWrite('canon/world.md'), /Protected files are never edited/)
    await denied(ai.checkWrite('notes/missing.md'), /Not available/)
    await denied(ai.checkCreate(CHAPTER), /Protected files are never edited/)
    await denied(ai.checkCreate('notes/ideas.md'), /File already exists/)
    await denied(ai.checkCreate('notes/nofolder/x.md'), /Not available/)
    expect(await ai.checkWrite('notes/ideas.md')).toBe('notes/ideas.md')
    expect(await ai.checkCreate('notes/fresh.md')).toBe('notes/fresh.md')
    expect(existsSync(path.join(root, 'notes/fresh.md'))).toBe(false)
    expect(await disk(CHAPTER)).toBe(CHAPTER_TEXT)
    expect(await disk('notes/ideas.md')).toBe('idea')
  })
})
