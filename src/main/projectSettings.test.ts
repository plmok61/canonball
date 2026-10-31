import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROJECT_SETTINGS, EMPTY_SETTINGS } from '../shared/access'
import {
  SETTINGS_REL,
  loadProjectAccess,
  saveProjectSettings,
  setPathAccess,
  setProsePaths
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
    const a = await loadProjectAccess(root)
    expect(a.needsProsePrompt).toBe(true)
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
    expect((await loadProjectAccess(root)).settings).toEqual(DEFAULT_PROJECT_SETTINGS)
  })

  it('an unreadable file is reported and never overwritten', async () => {
    await fs.mkdir(path.dirname(file()))
    await fs.writeFile(file(), '{oops')
    const a = await loadProjectAccess(root)
    expect(a.unreadable).toBe(true)
    expect(a.needsProsePrompt).toBe(false)
    await expect(setPathAccess(root, 'canon', 'read')).rejects.toThrow(
      'Project settings file is unreadable'
    )
    await expect(setProsePaths(root, ['drafts'])).rejects.toThrow(
      'Project settings file is unreadable'
    )
    expect(await fs.readFile(file(), 'utf8')).toBe('{oops')
  })

  it('setPathAccess stores and clears overrides', async () => {
    await saveProjectSettings(root, DEFAULT_PROJECT_SETTINGS)
    const a = await setPathAccess(root, 'canon/a.md', 'read')
    expect(a.settings.access['canon/a.md']).toBe('read')
    const b = await setPathAccess(root, 'canon/a.md', 'edit')
    expect(b.settings.access).not.toHaveProperty('canon/a.md')
  })

  it('setPathAccess on a project without the file starts from empty settings', async () => {
    const a = await setPathAccess(root, 'notes', 'hidden')
    expect(a.settings).toEqual({ version: 1, prose: [], access: { notes: 'hidden' } })
  })

  it('setProsePaths with nothing ticked still writes the file', async () => {
    const a = await setProsePaths(root, [])
    expect(a.settings.prose).toEqual([])
    const again = await loadProjectAccess(root)
    expect(again.needsProsePrompt).toBe(false)
    expect(again.settings.prose).toEqual([])
  })

  it('setProsePaths dedupes entries', async () => {
    const a = await setProsePaths(root, ['drafts', 'drafts'])
    expect(a.settings.prose).toEqual(['drafts'])
  })

  it('concurrent mutations are not lost', async () => {
    await saveProjectSettings(root, DEFAULT_PROJECT_SETTINGS)
    const a = setPathAccess(root, 'canon/a.md', 'read')
    const b = setPathAccess(root, 'notes/b.md', 'hidden')
    await Promise.all([a, b])
    const { access } = (await loadProjectAccess(root)).settings
    expect(access['canon/a.md']).toBe('read')
    expect(access['notes/b.md']).toBe('hidden')
  })

  it('a failed mutation does not block the next one', async () => {
    await saveProjectSettings(root, DEFAULT_PROJECT_SETTINGS)
    // Only the first queued mutation sees a failed read; the second reads the real file.
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    const read = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(err)
    try {
      const first = setPathAccess(root, 'canon', 'read')
      const second = setProsePaths(root, ['drafts', 'notes'])
      await expect(first).rejects.toThrow('Project settings file is unreadable')
      const next = await second
      expect(next.settings.prose).toEqual(['drafts', 'notes'])
      expect(next.settings.access.canon).toBe('edit')
      expect(next.unreadable).toBe(false)
    } finally {
      read.mockRestore()
    }
  })

  it('rejects escaping and empty paths', async () => {
    await expect(setPathAccess(root, '../x', 'read')).rejects.toThrow('Invalid path')
    await expect(setPathAccess(root, '', 'read')).rejects.toThrow('Invalid path')
    await expect(setProsePaths(root, ['a/../b'])).rejects.toThrow('Invalid path')
    await expect(fs.access(path.join(root, '.canonball'))).rejects.toThrow()
  })
})
