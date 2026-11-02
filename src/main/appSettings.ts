import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppSettings } from '../shared/types'
import { normalizeLocalUrl, parseModelChoice } from '../shared/ai'

const THEMES = ['light', 'dark', 'system']

function defaults(): AppSettings {
  return { lastProjectRoot: null, theme: 'system', ai: { localUrl: null, model: null } }
}

function parseLocalUrl(x: unknown): string | null {
  if (typeof x !== 'string') return null
  try {
    return normalizeLocalUrl(x)
  } catch {
    return null
  }
}

export async function loadSettings(file: string): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    const base = defaults()
    const ai = raw.ai && typeof raw.ai === 'object' ? raw.ai : {}
    return {
      lastProjectRoot: typeof raw.lastProjectRoot === 'string' ? raw.lastProjectRoot : null,
      theme: THEMES.includes(raw.theme) ? raw.theme : base.theme,
      ai: { localUrl: parseLocalUrl(ai.localUrl), model: parseModelChoice(ai.model) }
    }
  } catch {
    return defaults()
  }
}

export async function saveSettings(file: string, s: AppSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(s, null, 2), 'utf8')
}

export interface SettingsStore {
  load(): Promise<AppSettings>
  update(fn: (s: AppSettings) => AppSettings): Promise<AppSettings>
}

export function createSettingsStore(file: string): SettingsStore {
  let chain: Promise<unknown> = Promise.resolve()
  return {
    load: () => loadSettings(file),
    update(fn) {
      const run = async (): Promise<AppSettings> => {
        const next = fn(await loadSettings(file))
        await saveSettings(file, next)
        return next
      }
      const result = chain.then(run, run)
      chain = result.catch(() => undefined)
      return result
    }
  }
}
