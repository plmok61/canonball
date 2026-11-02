import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSettingsStore, loadSettings, saveSettings } from './appSettings'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'canonball-settings-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const defaults = { lastProjectRoot: null, theme: 'system', ai: { localUrl: null, model: null } }

it('returns defaults when file is missing', async () => {
  expect(await loadSettings(join(dir, 'settings.json'))).toEqual(defaults)
})

it('returns defaults when file is corrupt JSON', async () => {
  const file = join(dir, 'settings.json')
  await writeFile(file, '{not json')
  expect(await loadSettings(file)).toEqual(defaults)
})

it('save then load round-trips', async () => {
  const file = join(dir, 'settings.json')
  const s = {
    lastProjectRoot: '/some/where',
    theme: 'dark' as const,
    ai: {
      localUrl: 'http://localhost:11434/v1',
      model: { provider: 'local' as const, model: 'llama3' }
    }
  }
  await saveSettings(file, s)
  expect(await loadSettings(file)).toEqual(s)
})

it('loads ai defaults', async () => {
  const file = join(dir, 'settings.json')
  await writeFile(file, JSON.stringify({ theme: 'dark' }))
  expect((await loadSettings(file)).ai).toEqual({ localUrl: null, model: null })
})

it('drops an invalid stored model or URL', async () => {
  const file = join(dir, 'settings.json')
  await writeFile(
    file,
    JSON.stringify({ ai: { localUrl: 'ftp://x', model: { provider: 'bard', model: 'x' } } })
  )
  expect((await loadSettings(file)).ai).toEqual({ localUrl: null, model: null })
  await writeFile(file, JSON.stringify({ ai: { localUrl: 'http://localhost:11434/' } }))
  expect((await loadSettings(file)).ai.localUrl).toBe('http://localhost:11434/v1')
})

it('serializes concurrent updates', async () => {
  const store = createSettingsStore(join(dir, 'settings.json'))
  await Promise.all([
    store.update((s) => ({ ...s, theme: 'dark' })),
    store.update((s) => ({ ...s, lastProjectRoot: '/p' }))
  ])
  const s = await store.load()
  expect(s.theme).toBe('dark')
  expect(s.lastProjectRoot).toBe('/p')
})
