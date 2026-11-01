import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROJECT_SETTINGS, EMPTY_SETTINGS } from '../shared/protection'
import {
  SETTINGS_REL,
  loadProjectProtection,
  changeProtection,
  saveProjectSettings,
  setProtectedPaths
} from './projectSettings'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-settings-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

const file = (): string => path.join(root, SETTINGS_REL)

describe('project settings', () => {
  it('opening a project without settings writes nothing', async () => {
    await fs.mkdir(path.join(root, 'drafts'))
    const a = await loadProjectProtection(root)
    expect(a.needsProtectPrompt).toBe(true)
    expect(a.unreadable).toBe(false)
    expect(a.settings).toEqual(EMPTY_SETTINGS)
    await expect(fs.access(path.join(root, '.canonball'))).rejects.toThrow()
  })

  it('save then load round-trips with a trailing newline', async () => {
    const saved = await saveProjectSettings(root, DEFAULT_PROJECT_SETTINGS)
    expect(saved.settings).toEqual(DEFAULT_PROJECT_SETTINGS)
    const text = await fs.readFile(file(), 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toBe(JSON.stringify(DEFAULT_PROJECT_SETTINGS, null, 2) + '\n')
    expect((await loadProjectProtection(root)).settings).toEqual(DEFAULT_PROJECT_SETTINGS)
  })

  it('loads a version 1 file with prose as protected and access ignored', async () => {
    await fs.mkdir(path.dirname(file()))
    await fs.writeFile(
      file(),
      JSON.stringify({ version: 1, prose: ['drafts'], access: { notes: 'hidden' } })
    )
    const a = await loadProjectProtection(root)
    expect(a.unreadable).toBe(false)
    expect(a.needsProtectPrompt).toBe(false)
    expect(a.settings).toEqual({ version: 2, protected: ['drafts'] })
  })

  it('loading a version 1 file never rewrites it', async () => {
    await fs.mkdir(path.dirname(file()))
    const v1 = JSON.stringify({ version: 1, prose: ['drafts'], access: { canon: 'edit' } })
    await fs.writeFile(file(), v1)
    const past = new Date('2020-01-01T00:00:00Z')
    await fs.utimes(file(), past, past)
    const before = await fs.stat(file())
    await loadProjectProtection(root)
    const after = await fs.stat(file())
    expect(await fs.readFile(file(), 'utf8')).toBe(v1)
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('setProtectedPaths writes version 2 normalized', async () => {
    const a = await setProtectedPaths(root, ['a', 'a/b'])
    expect(a.settings).toEqual({ version: 2, protected: ['a'] })
    expect(await fs.readFile(file(), 'utf8')).toBe(
      JSON.stringify({ version: 2, protected: ['a'] }, null, 2) + '\n'
    )
  })

  it('setProtectedPaths replaces a version 1 file with version 2', async () => {
    await fs.mkdir(path.dirname(file()))
    await fs.writeFile(
      file(),
      JSON.stringify({ version: 1, prose: ['drafts'], access: { notes: 'hidden' } })
    )
    await setProtectedPaths(root, ['drafts', 'notes'])
    expect(JSON.parse(await fs.readFile(file(), 'utf8'))).toEqual({
      version: 2,
      protected: ['drafts', 'notes']
    })
  })

  it('an unreadable file is reported and never overwritten', async () => {
    await fs.mkdir(path.dirname(file()))
    await fs.writeFile(file(), '{oops')
    const a = await loadProjectProtection(root)
    expect(a.unreadable).toBe(true)
    expect(a.needsProtectPrompt).toBe(false)
    await expect(setProtectedPaths(root, ['drafts'])).rejects.toThrow(
      'Project settings file is unreadable'
    )
    expect(await fs.readFile(file(), 'utf8')).toBe('{oops')
  })

  it('setProtectedPaths with nothing ticked still writes the file', async () => {
    const a = await setProtectedPaths(root, [])
    expect(a.settings.protected).toEqual([])
    const again = await loadProjectProtection(root)
    expect(again.needsProtectPrompt).toBe(false)
    expect(again.settings.protected).toEqual([])
  })

  it('setProtectedPaths dedupes entries', async () => {
    const a = await setProtectedPaths(root, ['drafts', 'drafts'])
    expect(a.settings.protected).toEqual(['drafts'])
  })

  it('concurrent mutations run one after another', async () => {
    const a = setProtectedPaths(root, ['canon'])
    const b = setProtectedPaths(root, ['notes'])
    await Promise.all([a, b])
    expect((await loadProjectProtection(root)).settings.protected).toEqual(['notes'])
  })

  it('a failed mutation does not block the next one', async () => {
    await saveProjectSettings(root, DEFAULT_PROJECT_SETTINGS)
    // Only the first queued mutation sees a failed read; the second reads the real file.
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(err)
    try {
      const first = setProtectedPaths(root, ['canon'])
      const second = setProtectedPaths(root, ['drafts', 'notes'])
      await expect(first).rejects.toThrow('Project settings file is unreadable')
      const next = await second
      expect(next.settings.protected).toEqual(['drafts', 'notes'])
      expect(next.unreadable).toBe(false)
    } finally {
      read.mockRestore()
    }
  })

  it('rejects escaping and empty paths', async () => {
    await expect(setProtectedPaths(root, ['a/../b'])).rejects.toThrow('Invalid path')
    await expect(setProtectedPaths(root, [''])).rejects.toThrow('Invalid path')
    await expect(setProtectedPaths(root, ['../x'])).rejects.toThrow('Invalid path')
    await expect(fs.access(path.join(root, '.canonball'))).rejects.toThrow()
  })

  it('changeProtection applies to the file on disk, not a stale list', async () => {
    await setProtectedPaths(root, ['drafts'])
    await fs.writeFile(file(), JSON.stringify({ version: 2, protected: ['drafts', 'notes'] }))
    const out = await changeProtection(root, 'protect', 'canon')
    expect(JSON.parse(await fs.readFile(file(), 'utf8')).protected).toEqual([
      'drafts',
      'notes',
      'canon'
    ])
    expect(out.settings.protected).toEqual(['drafts', 'notes', 'canon'])
  })

  it('changeProtection with no effect writes nothing', async () => {
    await setProtectedPaths(root, ['drafts'])
    const past = new Date('2020-01-01T00:00:00Z')
    await fs.utimes(file(), past, past)
    const before = await fs.readFile(file(), 'utf8')
    const out = await changeProtection(root, 'unprotect', 'canon')
    expect(await fs.readFile(file(), 'utf8')).toBe(before)
    expect((await fs.stat(file())).mtimeMs).toBe(past.getTime())
    expect(out.settings.protected).toEqual(['drafts'])
  })

  it('changeProtection refuses an unreadable file', async () => {
    await fs.mkdir(path.dirname(file()))
    await fs.writeFile(file(), '{oops')
    await expect(changeProtection(root, 'protect', 'drafts')).rejects.toThrow(
      'Project settings file is unreadable'
    )
    expect(await fs.readFile(file(), 'utf8')).toBe('{oops')
  })

  it('changeProtection rejects an invalid path', async () => {
    await expect(changeProtection(root, 'protect', '../x')).rejects.toThrow('Invalid path')
  })
})
