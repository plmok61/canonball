import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createAiConfig } from './aiConfig'
import { createSettingsStore } from '../appSettings'
import type { SecretStore } from './secrets'
import type { FetchFn } from './adapter'
import type { CloudProvider } from '../../shared/ai'

function fakeSecrets(initial: Partial<Record<CloudProvider, string>> = {}): SecretStore {
  const keys: Partial<Record<CloudProvider, string>> = { ...initial }
  return {
    available: () => true,
    status: async () => ({
      anthropic: !!keys.anthropic,
      openai: !!keys.openai,
      google: !!keys.google
    }),
    get: async (p) => keys[p] ?? null,
    set: async (p, k) => {
      keys[p] = k.trim()
    },
    clear: async (p) => {
      delete keys[p]
    }
  }
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status })

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'canonball-aiconfig-'))
  file = join(dir, 'settings.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const noFetch: FetchFn = async () => {
  throw new Error('unexpected fetch')
}

it('status never contains key text', async () => {
  const ai = createAiConfig({
    settings: createSettingsStore(file),
    secrets: fakeSecrets(),
    fetch: noFetch
  })
  const after = await ai.setApiKey('openai', 'sk-secret-123')
  expect(JSON.stringify(after)).not.toContain('sk-')
  const st = await ai.status()
  expect(JSON.stringify(st)).not.toContain('sk-')
  expect(st.keys).toEqual({ anthropic: false, openai: true, google: false })
  expect(st.encryptionAvailable).toBe(true)
  expect((await ai.setApiKey('openai', null)).keys.openai).toBe(false)
})

it('listModels queries only configured providers and keeps the others when one fails', async () => {
  const urls: string[] = []
  const fetchFn: FetchFn = async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.startsWith('https://api.openai.com/')) return json({ error: { message: 'no' } }, 401)
    if (u === 'http://localhost:11434/v1/models') return json({ data: [{ id: 'llama3' }] })
    throw new Error('unexpected ' + u)
  }
  const ai = createAiConfig({
    settings: createSettingsStore(file),
    secrets: fakeSecrets({ openai: 'sk-test' }),
    fetch: fetchFn
  })
  await ai.setLocalUrl('http://localhost:11434')
  const list = await ai.listModels()
  expect(list.models).toEqual([{ provider: 'local', model: 'llama3', label: 'llama3' }])
  expect(list.errors).toEqual([
    { provider: 'openai', message: 'The OpenAI API key was rejected. Check it in Settings.' }
  ])
  expect(urls).toHaveLength(2)
  expect(JSON.stringify(list)).not.toContain('sk-')
})

it('resolve without a key asks for one in Settings', async () => {
  const ai = createAiConfig({
    settings: createSettingsStore(file),
    secrets: fakeSecrets(),
    fetch: noFetch
  })
  await expect(ai.resolve('anthropic')).rejects.toThrow('Add a Anthropic API key in Settings.')
  await expect(ai.resolve('local')).rejects.toThrow('Add a local server URL in Settings.')
  await ai.setApiKey('anthropic', 'sk-ant')
  expect(await ai.resolve('anthropic')).toEqual({
    provider: 'anthropic',
    apiKey: 'sk-ant',
    baseUrl: 'https://api.anthropic.com/v1'
  })
})

it('setLocalUrl normalizes and clears', async () => {
  const ai = createAiConfig({
    settings: createSettingsStore(file),
    secrets: fakeSecrets(),
    fetch: noFetch
  })
  expect((await ai.setLocalUrl('http://localhost:11434/')).localUrl).toBe(
    'http://localhost:11434/v1'
  )
  expect(await ai.resolve('local')).toEqual({
    provider: 'local',
    apiKey: null,
    baseUrl: 'http://localhost:11434/v1'
  })
  await expect(ai.setLocalUrl('localhost')).rejects.toThrow(
    'Enter a URL starting with http:// or https://'
  )
  expect((await ai.setLocalUrl(null)).localUrl).toBeNull()
  expect((await ai.status()).localUrl).toBeNull()
})

it('setModel stores the choice app-wide', async () => {
  const ai = createAiConfig({
    settings: createSettingsStore(file),
    secrets: fakeSecrets(),
    fetch: noFetch
  })
  const choice = { provider: 'local' as const, model: 'llama3' }
  expect((await ai.setModel(choice)).model).toEqual(choice)
  const again = createAiConfig({
    settings: createSettingsStore(file),
    secrets: fakeSecrets(),
    fetch: noFetch
  })
  expect((await again.status()).model).toEqual(choice)
  expect((await ai.setModel(null)).model).toBeNull()
})
