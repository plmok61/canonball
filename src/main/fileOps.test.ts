import fsSync, { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkedPath,
  createEntry,
  moveExact,
  pasteEntries,
  removeCreated,
  renameEntry,
  restoreEntries,
  trashEntries
} from './fileOps'
import { SETTINGS_REL, loadProjectProtection, saveProjectSettings } from './projectSettings'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-fileops-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true })
})

const at = (rel: string): string => path.join(root, rel)

async function put(rel: string, content = ''): Promise<void> {
  await fs.mkdir(path.dirname(at(rel)), { recursive: true })
  await fs.writeFile(at(rel), content)
}

async function exists(rel: string): Promise<boolean> {
  try {
    await fs.lstat(at(rel))
    return true
  } catch {
    return false
  }
}

async function protect(paths: string[]): Promise<void> {
  await saveProjectSettings(root, { version: 2, protected: paths })
}

const protectedNow = async (): Promise<string[]> =>
  (await loadProjectProtection(root)).settings.protected

describe('createEntry', () => {
  it('creates a file with .md once', async () => {
    await fs.mkdir(at('drafts'))
    const out = await createEntry(root, 'file', 'drafts', 'Chapter 4.md')
    expect(out.relPath).toBe('drafts/Chapter 4.md')
    expect(await fs.readFile(at('drafts/Chapter 4.md'), 'utf8')).toBe('')
    expect(out.tree.find((n) => n.name === 'drafts')?.children?.[0].name).toBe('Chapter 4.md')
  })

  it('creates a folder at the top level', async () => {
    const out = await createEntry(root, 'folder', '', 'book')
    expect(out.relPath).toBe('book')
    expect((await fs.stat(at('book'))).isDirectory()).toBe(true)
  })

  it('refuses an existing name', async () => {
    await put('drafts/a.md', 'keep')
    await expect(createEntry(root, 'file', 'drafts', 'a')).rejects.toThrow('"a.md" already exists')
    expect(await fs.readFile(at('drafts/a.md'), 'utf8')).toBe('keep')
  })
})

describe('renameEntry', () => {
  it('case-only rename works', async () => {
    await put('drafts/ch.md', 'text')
    const out = await renameEntry(root, 'drafts/ch.md', 'Ch')
    expect(out.move).toEqual({ from: 'drafts/ch.md', to: 'drafts/Ch.md' })
    expect(await fs.readdir(at('drafts'))).toEqual(['Ch.md'])
    expect(await fs.readFile(at('drafts/Ch.md'), 'utf8')).toBe('text')
  })

  it('rename refuses an existing name', async () => {
    await put('drafts/a.md', 'A')
    await put('drafts/b.md', 'B')
    await expect(renameEntry(root, 'drafts/a.md', 'b')).rejects.toThrow('"b.md" already exists')
    expect(await fs.readFile(at('drafts/a.md'), 'utf8')).toBe('A')
    expect(await fs.readFile(at('drafts/b.md'), 'utf8')).toBe('B')
  })

  it('moving a protected folder never leaves a gap', async () => {
    await put('drafts/ch.md', 'text')
    await protect(['drafts'])
    const seen: string[][] = []
    const realRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === at('drafts') && to === at('chapters')) {
        seen.push(JSON.parse(fsSync.readFileSync(at(SETTINGS_REL), 'utf8')).protected)
      }
      return realRename(from, to)
    })
    const out = await renameEntry(root, 'drafts', 'chapters')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual(expect.arrayContaining(['drafts', 'chapters']))
    expect(JSON.parse(await fs.readFile(at(SETTINGS_REL), 'utf8')).protected).toEqual(['chapters'])
    expect(out.protection.settings.protected).toEqual(['chapters'])
  })

  it('refuses to move protection when the settings file is unreadable', async () => {
    await put('drafts/ch.md')
    await put(SETTINGS_REL, '{oops')
    await expect(renameEntry(root, 'drafts', 'chapters')).rejects.toThrow(
      'Project settings file is unreadable'
    )
    expect(await exists('drafts')).toBe(true)
    expect(await fs.readFile(at(SETTINGS_REL), 'utf8')).toBe('{oops')
  })
})

describe('pasteEntries', () => {
  it('paste copies with unique names', async () => {
    await put('a/x.md', 'from a')
    await put('b/x.md', 'from b')
    await fs.mkdir(at('c'))
    const out = await pasteEntries(root, 'copy', ['a/x.md', 'b/x.md'], 'c')
    expect(out.created).toEqual(['c/x.md', 'c/x copy.md'])
    expect(out.moves).toEqual([])
    expect(await fs.readFile(at('c/x.md'), 'utf8')).toBe('from a')
    expect(await fs.readFile(at('c/x copy.md'), 'utf8')).toBe('from b')
    expect(await fs.readFile(at('a/x.md'), 'utf8')).toBe('from a')
    expect(await fs.readFile(at('b/x.md'), 'utf8')).toBe('from b')
  })

  it('paste move refuses into itself', async () => {
    await put('book/ch/one.md')
    await expect(pasteEntries(root, 'move', ['book'], 'book/ch')).rejects.toThrow(
      "Can't move a folder into itself."
    )
    expect(await exists('book/ch/one.md')).toBe(true)
    expect(await exists('book/ch/book')).toBe(false)
  })

  it('paste move renames on a clash and carries protection', async () => {
    await put('a/x.md', 'A')
    await put('c/x.md', 'C')
    await protect(['a/x.md'])
    const out = await pasteEntries(root, 'move', ['a/x.md'], 'c')
    expect(out.moves).toEqual([{ from: 'a/x.md', to: 'c/x copy.md' }])
    expect(out.created).toEqual([])
    expect(await fs.readFile(at('c/x copy.md'), 'utf8')).toBe('A')
    expect(await fs.readFile(at('c/x.md'), 'utf8')).toBe('C')
    expect(await protectedNow()).toEqual(['c/x copy.md'])
  })

  it('a move into its own folder is skipped', async () => {
    await put('a/x.md', 'A')
    const out = await pasteEntries(root, 'move', ['a/x.md'], 'a')
    expect(out.moves).toEqual([])
    expect(await fs.readdir(at('a'))).toEqual(['x.md'])
  })
})

describe('moveExact', () => {
  it('moveExact refuses if a target exists, before moving anything', async () => {
    await put('a.md', 'A')
    await put('b.md', 'B')
    await put('c.md', 'C')
    await expect(
      moveExact(root, [
        { from: 'a.md', to: 'd.md' },
        { from: 'b.md', to: 'c.md' }
      ])
    ).rejects.toThrow('"c.md" already exists')
    expect(await exists('a.md')).toBe(true)
    expect(await exists('d.md')).toBe(false)
    expect(await fs.readFile(at('c.md'), 'utf8')).toBe('C')
  })

  it('moves exactly as given, protection included', async () => {
    await put('c/x copy.md', 'A')
    await fs.mkdir(at('a'))
    await protect(['c/x copy.md'])
    await moveExact(root, [{ from: 'c/x copy.md', to: 'a/x.md' }])
    expect(await fs.readFile(at('a/x.md'), 'utf8')).toBe('A')
    expect(await protectedNow()).toEqual(['a/x.md'])
  })
})

describe('undo of a move that folds protection', () => {
  it('a protected file moved into a protected folder is protected again after undo', async () => {
    await put('notes/a.md', 'A')
    await fs.mkdir(at('drafts'))
    await protect(['drafts', 'notes/a.md'])
    const out = await pasteEntries(root, 'move', ['notes/a.md'], 'drafts')
    expect(out.moves).toEqual([{ from: 'notes/a.md', to: 'drafts/a.md' }])
    expect(out.folded).toEqual(['notes/a.md'])
    expect(await protectedNow()).toEqual(['drafts'])
    const back = await moveExact(
      root,
      out.moves.map((m) => ({ from: m.to, to: m.from })),
      out.folded
    )
    expect(await fs.readFile(at('notes/a.md'), 'utf8')).toBe('A')
    expect(await protectedNow()).toEqual(['drafts', 'notes/a.md'])
    expect(back.protection.settings.protected).toEqual(['drafts', 'notes/a.md'])
    // Redo folds it again through the normal remap.
    const redo = await moveExact(root, out.moves)
    expect(redo.folded).toEqual(['notes/a.md'])
    expect(await protectedNow()).toEqual(['drafts'])
  })

  it('a folder holding a nested protected entry gets it back after undo', async () => {
    await put('book/ch/one.md', '1')
    await put('book/two.md', '2')
    await fs.mkdir(at('drafts'))
    await protect(['drafts', 'book/ch'])
    const out = await pasteEntries(root, 'move', ['book'], 'drafts')
    expect(out.folded).toEqual(['book/ch'])
    expect(await protectedNow()).toEqual(['drafts'])
    await moveExact(root, [{ from: 'drafts/book', to: 'book' }], out.folded)
    expect(await fs.readFile(at('book/ch/one.md'), 'utf8')).toBe('1')
    expect(await protectedNow()).toEqual(['drafts', 'book/ch'])
  })

  it('restored protection is in place before the item moves back', async () => {
    await put('notes/a.md', 'A')
    await fs.mkdir(at('drafts'))
    await protect(['drafts', 'notes/a.md'])
    const out = await pasteEntries(root, 'move', ['notes/a.md'], 'drafts')
    const seen: string[][] = []
    const realRename = fs.rename.bind(fs)
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (from === at('drafts/a.md')) {
        seen.push(JSON.parse(fsSync.readFileSync(at(SETTINGS_REL), 'utf8')).protected)
      }
      return realRename(from, to)
    })
    await moveExact(root, [{ from: 'drafts/a.md', to: 'notes/a.md' }], out.folded)
    expect(seen).toEqual([expect.arrayContaining(['drafts', 'notes/a.md'])])
  })

  it('rename reports what it folded', async () => {
    await put('notes/a.md', 'A')
    // `x` is protected though nothing is there yet.
    await protect(['x', 'notes/a.md'])
    const out = await renameEntry(root, 'notes', 'x')
    expect(out.folded).toEqual(['notes/a.md'])
    expect(await protectedNow()).toEqual(['x'])
    await moveExact(root, [{ from: 'x', to: 'notes' }], out.folded)
    // The `x` entry follows the folder back, so it covers `notes/a.md` again.
    expect(await protectedNow()).toEqual(['notes'])
  })

  it('refuses restore entries outside the paths the items return to', async () => {
    await put('drafts/a.md', 'A')
    await fs.mkdir(at('notes'))
    await protect(['drafts'])
    await expect(
      moveExact(root, [{ from: 'drafts/a.md', to: 'notes/a.md' }], ['other.md'])
    ).rejects.toThrow('Invalid path')
    await expect(
      moveExact(root, [{ from: 'drafts/a.md', to: 'notes/a.md' }], ['notes/.x'])
    ).rejects.toThrow('Invalid path')
    expect(await exists('drafts/a.md')).toBe(true)
    expect(await protectedNow()).toEqual(['drafts'])
  })

  it('writes nothing when there is nothing to restore', async () => {
    await put('a.md', 'A')
    await moveExact(root, [{ from: 'a.md', to: 'b.md' }], [])
    expect(await exists(SETTINGS_REL)).toBe(false)
  })
})

describe('trash and restore', () => {
  it('trash keeps the item in the holding area and drops protection', async () => {
    await put('drafts/ch.md', 'text')
    await protect(['drafts'])
    const out = await trashEntries(root, ['drafts'])
    expect(out.trashed).toHaveLength(1)
    const [item] = out.trashed
    expect(item.from).toBe('drafts')
    expect(item.protectedEntries).toEqual(['drafts'])
    expect(await fs.readFile(at(`.canonball/trash/${item.id}/drafts/ch.md`), 'utf8')).toBe('text')
    expect(await exists('drafts')).toBe(false)
    expect(await protectedNow()).toEqual([])
    expect(out.tree).toEqual([])
  })

  it('restore puts it back with protection', async () => {
    await put('drafts/ch.md', 'text')
    await protect(['drafts'])
    const { trashed } = await trashEntries(root, ['drafts'])
    const out = await restoreEntries(root, trashed)
    expect(await fs.readFile(at('drafts/ch.md'), 'utf8')).toBe('text')
    expect(await protectedNow()).toEqual(['drafts'])
    expect(out.protection.settings.protected).toEqual(['drafts'])
    expect(await exists(`.canonball/trash/${trashed[0].id}`)).toBe(false)
  })

  it('restore refuses when the original path is taken', async () => {
    await put('drafts/ch.md', 'text')
    const { trashed } = await trashEntries(root, ['drafts'])
    await fs.mkdir(at('drafts'))
    await expect(restoreEntries(root, trashed)).rejects.toThrow('"drafts" already exists')
    expect(await exists(`.canonball/trash/${trashed[0].id}/drafts/ch.md`)).toBe(true)
  })

  it('restore refuses when the holding item is gone', async () => {
    await put('drafts/ch.md', 'text')
    const { trashed } = await trashEntries(root, ['drafts'])
    await fs.rm(at('.canonball/trash'), { recursive: true })
    await expect(restoreEntries(root, trashed)).rejects.toThrow("it's already in the Trash")
  })

  it('removeCreated moves created items into the holding area', async () => {
    await put('c/x.md', 'typed')
    const out = await removeCreated(root, ['c/x.md'])
    expect(out.trashed[0].from).toBe('c/x.md')
    expect(await exists('c/x.md')).toBe(false)
    expect(await exists(`.canonball/trash/${out.trashed[0].id}/x.md`)).toBe(true)
  })
})

describe('validation', () => {
  it('rejects dot names and escapes', async () => {
    await put('x.md')
    await expect(createEntry(root, 'file', '', '.x')).rejects.toThrow()
    await expect(renameEntry(root, '../x', 'y')).rejects.toThrow()
    await expect(renameEntry(root, '.canonball', 'y')).rejects.toThrow()
    await expect(pasteEntries(root, 'copy', ['x.md'], 'node_modules')).rejects.toThrow()
    expect(await exists('.x.md')).toBe(false)
  })
})

describe('checkedPath (used by reveal)', () => {
  it('refuses dot-segments and node_modules, accepts plain paths', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-cp-'))
    const real = await fs.realpath(dir)
    expect(() => checkedPath(dir, '.canonball/trash')).toThrow()
    expect(() => checkedPath(dir, 'a/.git')).toThrow()
    expect(() => checkedPath(dir, 'node_modules/x')).toThrow()
    expect(checkedPath(dir, 'notes/a.md')).toBe(path.join(dir, 'notes/a.md'))
    expect(real).toBeTruthy()
    await fs.rm(dir, { recursive: true, force: true })
  })
})
