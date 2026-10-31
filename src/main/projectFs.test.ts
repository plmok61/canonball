import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  listTree,
  readDoc,
  requireCurrentRoot,
  resolveInside,
  writeDoc
} from './projectFs'
import { DEFAULT_PROJECT_SETTINGS, parseProjectSettings } from '../shared/access'
import type { TreeNode } from '../shared/types'

let tmp: string
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-test-'))
})
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('resolveInside', () => {
  it('rejects ../ escapes, absolute paths and outside symlinks', async () => {
    const root = path.join(tmp, 'root')
    const outside = path.join(tmp, 'outside')
    await fs.mkdir(root)
    await fs.mkdir(outside)
    await fs.symlink(outside, path.join(root, 'link'))
    expect(() => resolveInside(root, '../outside/x.md')).toThrow('Path escapes project')
    expect(() => resolveInside(root, '/etc/passwd')).toThrow('Path escapes project')
    expect(() => resolveInside(root, 'link/x.md')).toThrow('Path escapes project')
    expect(resolveInside(root, 'canon/a.md')).toBe(path.join(root, 'canon', 'a.md'))
  })
})

describe('requireCurrentRoot', () => {
  it('returns the root only when it is the project the caller believes is open', () => {
    expect(requireCurrentRoot('/a', '/a')).toBe('/a')
    expect(() => requireCurrentRoot('/b', '/a')).toThrow('Project changed')
    expect(() => requireCurrentRoot(null, '/a')).toThrow('No project open')
  })
})

describe('listTree', () => {
  it('returns folders and .md files, skipping dotfiles, node_modules and non-md files', async () => {
    await fs.mkdir(path.join(tmp, 'canon'))
    await fs.writeFile(path.join(tmp, 'canon', 'world.md'), 'w')
    await fs.writeFile(path.join(tmp, 'canon', 'pic.png'), 'x')
    await fs.mkdir(path.join(tmp, '.canonball'))
    await fs.writeFile(path.join(tmp, '.hidden.md'), 'h')
    await fs.mkdir(path.join(tmp, 'node_modules'))
    await fs.writeFile(path.join(tmp, 'README.md'), 'r')
    const tree = await listTree(tmp)
    const byName = (n: TreeNode[], name: string): TreeNode | undefined =>
      n.find((x) => x.name === name)
    expect(tree.map((n) => n.name).sort()).toEqual(['README.md', 'canon'])
    const canon = byName(tree, 'canon')!
    expect(canon.kind).toBe('folder')
    expect(canon.children!.map((c) => c.relPath)).toEqual(['canon/world.md'])
    expect(byName(tree, 'README.md')!.kind).toBe('file')
  })
})

describe('writeDoc / readDoc', () => {
  it('round-trips content and returns a newer mtime', async () => {
    await fs.writeFile(path.join(tmp, 'a.md'), 'old')
    const before = await readDoc(tmp, 'a.md')
    await new Promise((r) => setTimeout(r, 20))
    const written = await writeDoc(tmp, 'a.md', 'new text')
    expect(written.mtimeMs).toBeGreaterThan(before.mtimeMs)
    const after = await readDoc(tmp, 'a.md')
    expect(after.content).toBe('new text')
    expect(after.mtimeMs).toBe(written.mtimeMs)
    expect((await fs.readdir(tmp)).filter((f) => f.includes('.tmp'))).toEqual([])
  })
})

describe('createProject', () => {
  const templateDir = path.join(process.cwd(), 'template')

  it('copies template and writes .gitignore with .canonball/chats/', async () => {
    const target = path.join(tmp, 'book')
    await createProject(target, templateDir)
    await fs.access(path.join(target, 'canon', 'characters.md'))
    await fs.access(path.join(target, 'memory', 'style_rules.md'))
    await expect(fs.access(path.join(target, 'CLAUDE.md'))).rejects.toThrow()
    expect(await fs.readFile(path.join(target, '.gitignore'), 'utf8')).toContain(
      '.canonball/chats/'
    )
  })

  it('createProject writes default AI permissions', async () => {
    const target = path.join(tmp, 'book')
    await createProject(target, templateDir)
    const raw = JSON.parse(
      await fs.readFile(path.join(target, '.canonball', 'project.json'), 'utf8')
    )
    expect(parseProjectSettings(raw)).toEqual(DEFAULT_PROJECT_SETTINGS)
    expect(await fs.readFile(path.join(target, '.gitignore'), 'utf8')).toContain(
      '.canonball/chats/'
    )
  })

  it('refuses a non-empty folder', async () => {
    await fs.writeFile(path.join(tmp, 'x.txt'), 'x')
    await expect(createProject(tmp, templateDir)).rejects.toThrow('Folder is not empty')
  })
})
