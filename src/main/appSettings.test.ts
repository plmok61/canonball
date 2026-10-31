import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadSettings, saveSettings } from './appSettings'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'canonball-settings-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const defaults = { lastProjectRoot: null, theme: 'system' }

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
  const s = { lastProjectRoot: '/some/where', theme: 'dark' as const }
  await saveSettings(file, s)
  expect(await loadSettings(file)).toEqual(s)
})
