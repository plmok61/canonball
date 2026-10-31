import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AppSettings } from '../shared/types'

const THEMES = ['light', 'dark', 'system']

function defaults(): AppSettings {
  return { lastProjectRoot: null, theme: 'system' }
}

export async function loadSettings(file: string): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'))
    const base = defaults()
    return {
      lastProjectRoot: typeof raw.lastProjectRoot === 'string' ? raw.lastProjectRoot : null,
      theme: THEMES.includes(raw.theme) ? raw.theme : base.theme
    }
  } catch {
    return defaults()
  }
}

export async function saveSettings(file: string, s: AppSettings): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(s, null, 2), 'utf8')
}
