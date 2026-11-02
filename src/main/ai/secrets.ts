import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { CLOUD_PROVIDERS, type CloudProvider } from '../../shared/ai'

export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export interface SecretStore {
  available(): boolean
  status(): Promise<Record<CloudProvider, boolean>>
  get(p: CloudProvider): Promise<string | null>
  set(p: CloudProvider, key: string): Promise<void>
  clear(p: CloudProvider): Promise<void>
}

const BAD_KEY = "That doesn't look like an API key."
const NO_KEYCHAIN = "This Mac's Keychain isn't available, so API keys can't be saved."

async function readEntries(file: string): Promise<Partial<Record<CloudProvider, string>>> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    const out: Partial<Record<CloudProvider, string>> = {}
    if (raw && typeof raw === 'object') {
      for (const p of CLOUD_PROVIDERS) if (typeof raw[p] === 'string' && raw[p]) out[p] = raw[p]
    }
    return out
  } catch {
    return {}
  }
}

export function createSecretStore(file: string, enc: Encryptor): SecretStore {
  let chain: Promise<unknown> = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = chain.then(run, run)
    chain = result.catch(() => undefined)
    return result
  }
  async function write(entries: Partial<Record<CloudProvider, string>>): Promise<void> {
    await mkdir(dirname(file), { recursive: true })
    const tmp = file + '.tmp'
    await writeFile(tmp, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 })
    await rename(tmp, file)
  }
  return {
    available: () => enc.isEncryptionAvailable(),
    async status() {
      const e = await readEntries(file)
      return { anthropic: !!e.anthropic, openai: !!e.openai, google: !!e.google }
    },
    async get(p) {
      const v = (await readEntries(file))[p]
      if (!v) return null
      try {
        return enc.decryptString(Buffer.from(v, 'base64'))
      } catch {
        return null
      }
    },
    set(p, key) {
      const k = key.trim()
      if (k.length > 500 || !/^[\x21-\x7e]+$/.test(k)) return Promise.reject(new Error(BAD_KEY))
      if (!enc.isEncryptionAvailable()) return Promise.reject(new Error(NO_KEYCHAIN))
      return serialize(async () => {
        const e = await readEntries(file)
        e[p] = enc.encryptString(k).toString('base64')
        await write(e)
      })
    },
    clear(p) {
      return serialize(async () => {
        const e = await readEntries(file)
        if (!(p in e)) return
        delete e[p]
        await write(e)
      })
    }
  }
}
