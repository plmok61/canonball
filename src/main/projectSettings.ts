import { promises as fsp } from 'fs'
import path from 'path'
import {
  EMPTY_SETTINGS,
  parseProjectSettings,
  validPath,
  withAccess,
  withProse
} from '../shared/access'
import type { Access, ProjectAccess, ProjectSettings } from '../shared/types'
import { resolveInside, writeDoc } from './projectFs'

export const SETTINGS_REL = '.canonball/project.json'

/** Reads the settings file. Never writes. */
export async function loadProjectAccess(root: string): Promise<ProjectAccess> {
  let text: string
  try {
    text = await fsp.readFile(resolveInside(root, SETTINGS_REL), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { settings: EMPTY_SETTINGS, needsProsePrompt: true, unreadable: false }
    }
    return { settings: EMPTY_SETTINGS, needsProsePrompt: false, unreadable: true }
  }
  let parsed: ProjectSettings | null
  try {
    parsed = parseProjectSettings(JSON.parse(text))
  } catch {
    parsed = null
  }
  if (!parsed) return { settings: EMPTY_SETTINGS, needsProsePrompt: false, unreadable: true }
  return { settings: parsed, needsProsePrompt: false, unreadable: false }
}

export async function saveProjectSettings(
  root: string,
  s: ProjectSettings
): Promise<ProjectAccess> {
  await fsp.mkdir(path.dirname(resolveInside(root, SETTINGS_REL)), { recursive: true })
  await writeDoc(root, SETTINGS_REL, JSON.stringify(s, null, 2) + '\n')
  return loadProjectAccess(root)
}

async function editable(root: string): Promise<ProjectSettings> {
  const loaded = await loadProjectAccess(root)
  if (loaded.unreadable) throw new Error('Project settings file is unreadable')
  return loaded.settings
}

/** Tail of the pending mutations per project root, so read-modify-writes never overlap. */
const queues = new Map<string, Promise<unknown>>()

function serialized<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(root)
  const run = (queues.get(key) ?? Promise.resolve()).then(fn)
  const tail = run.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run
}

export async function setPathAccess(
  root: string,
  relPath: string,
  a: Access
): Promise<ProjectAccess> {
  if (!validPath(relPath)) throw new Error('Invalid path')
  return serialized(root, async () =>
    saveProjectSettings(root, withAccess(await editable(root), relPath, a))
  )
}

export async function setProsePaths(root: string, prose: string[]): Promise<ProjectAccess> {
  if (!prose.every(validPath)) throw new Error('Invalid path')
  return serialized(root, async () =>
    saveProjectSettings(root, withProse(await editable(root), [...new Set(prose)]))
  )
}
