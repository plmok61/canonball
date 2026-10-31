import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSecretStore, type Encryptor } from './secrets'

const rev = (s: string): string => s.split('').reverse().join('')
const fake = (available = true, failDecrypt = false): Encryptor => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('enc:' + rev(s)),
  decryptString: (b) => {
    if (failDecrypt) throw new Error('bad')
    return rev(b.toString().slice(4))
  }
})

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'canonball-secrets-'))
  file = join(dir, 'secrets.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

it('stores only ciphertext', async () => {
  const s = createSecretStore(file, fake())
  await s.set('openai', 'sk-test-123')
  expect(await readFile(file, 'utf8')).not.toContain('sk-test-123')
  expect(await s.get('openai')).toBe('sk-test-123')
  expect((await stat(file)).mode & 0o777).toBe(0o600)
})

it('status reports booleans only', async () => {
  const s = createSecretStore(file, fake())
  await s.set('openai', 'sk-test-123')
  const st = await s.status()
  expect(st).toEqual({ anthropic: false, openai: true, google: false })
  expect(Object.values(st).every((v) => typeof v === 'boolean')).toBe(true)
})

it('clear removes the key', async () => {
  const s = createSecretStore(file, fake())
  await s.set('google', 'abc')
  await s.clear('google')
  expect(await s.get('google')).toBeNull()
  expect((await s.status()).google).toBe(false)
})

it('rejects malformed keys', async () => {
  const s = createSecretStore(file, fake())
  for (const k of ['', 'a b', 'a'.repeat(501), 'sk-abc​def', 'sk-ключ']) {
    await expect(s.set('openai', k)).rejects.toThrow("That doesn't look like an API key.")
  }
})

it('refuses when encryption is unavailable', async () => {
  const s = createSecretStore(file, fake(false))
  await expect(s.set('openai', 'sk-x')).rejects.toThrow(
    "This Mac's Keychain isn't available, so API keys can't be saved."
  )
  await expect(stat(file)).rejects.toThrow()
})

it('an undecryptable entry reads as unset', async () => {
  await createSecretStore(file, fake()).set('anthropic', 'sk-ant')
  expect(await createSecretStore(file, fake(true, true)).get('anthropic')).toBeNull()
})
