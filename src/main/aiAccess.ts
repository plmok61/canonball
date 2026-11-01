/**
 * The only door the AI gets to the project on disk (Phase 5's tools call it).
 * Main-process only: not wired to IPC and never reachable from the renderer.
 *
 * Every path is canonicalized to its real on-disk spelling (case, symlinks,
 * `..`) before any check, and the settings file is re-read on every call, so
 * prose can never be written however the path is spelled.
 */
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import { effectiveAccess, isProse } from '../shared/access'
import type { DocFile, ProjectSettings, TreeNode } from '../shared/types'
import { listTree, readDoc, resolveInside, writeDoc } from './projectFs'
import { loadProjectAccess } from './projectSettings'

export class AccessDenied extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccessDenied'
  }
}

export interface AiFile {
  relPath: string
  access: 'edit' | 'read'
}

export interface AiAccess {
  /** Real on-disk relPath, '/'-separated. Throws AccessDenied on escape. */
  canonicalize(relPath: string): string
  /** Every .md file the AI can see, sorted by relPath. */
  list(): Promise<AiFile[]>
  read(relPath: string): Promise<DocFile>
  /** Canonical path if write() would be allowed now; throws the same AccessDenied. Writes nothing. */
  checkWrite(relPath: string): Promise<string>
  /** Canonical path if create() would be allowed now (also refuses an existing file); writes nothing. */
  checkCreate(relPath: string): Promise<string>
  /** Existing file only. */
  write(relPath: string, content: string): Promise<DocFile>
  /** New file only; never overwrites and makes no folders. */
  create(relPath: string, content: string): Promise<DocFile>
}

const notAvailable = (p: string): AccessDenied => new AccessDenied(`Not available to the AI: ${p}`)

function flattenFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n.relPath)
    else if (n.children) flattenFiles(n.children, out)
  }
  return out
}

/** Dot-paths (settings, chats, temp files), node_modules and non-markdown are off limits. */
function isAvailablePath(canonical: string): boolean {
  if (canonical === '' || !canonical.endsWith('.md')) return false
  return canonical.split('/').every((seg) => !seg.startsWith('.') && seg !== 'node_modules')
}

async function kind(full: string): Promise<'file' | 'folder' | 'other' | null> {
  try {
    const st = await fsp.stat(full)
    return st.isFile() ? 'file' : st.isDirectory() ? 'folder' : 'other'
  } catch {
    return null
  }
}

export function createAiAccess(root: string): AiAccess {
  function canonicalize(relPath: string): string {
    if (typeof relPath !== 'string' || relPath === '') throw notAvailable(String(relPath))
    let full: string
    let realRoot: string
    try {
      full = resolveInside(root, relPath)
      realRoot = fs.realpathSync.native(root)
    } catch {
      throw notAvailable(relPath)
    }
    // realpath the deepest existing ancestor (fixes letter case, follows
    // symlinks), then re-append the part that does not exist yet.
    let existing = full
    const tail: string[] = []
    while (!fs.existsSync(existing)) {
      tail.unshift(path.basename(existing))
      existing = path.dirname(existing)
    }
    let real: string
    try {
      real = fs.realpathSync.native(existing)
    } catch {
      throw notAvailable(relPath)
    }
    const rel = path.relative(realRoot, path.join(real, ...tail))
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw notAvailable(relPath)
    return rel.split(path.sep).join('/')
  }

  /**
   * Fresh settings for this call. Prose entries are also matched in their
   * canonical spelling, so a hand-typed "DRAFTS" or a symlinked prose folder
   * still protects the real files.
   */
  async function settings(): Promise<{ s: ProjectSettings; unreadable: boolean }> {
    const loaded = await loadProjectAccess(root)
    const prose = new Set(loaded.settings.prose)
    for (const p of loaded.settings.prose) {
      try {
        prose.add(canonicalize(p))
      } catch {
        // Escaping or unresolvable entries keep their literal spelling only.
      }
    }
    return { s: { ...loaded.settings, prose: [...prose] }, unreadable: loaded.unreadable }
  }

  /** Canonical path of an available .md file; throws AccessDenied otherwise. */
  function target(relPath: string): string {
    const canonical = canonicalize(relPath)
    if (!isAvailablePath(canonical)) throw notAvailable(relPath)
    return canonical
  }

  /** Settings for this call; a corrupt file grants nothing, so hidden files stay hidden. */
  async function readableSettings(): Promise<ProjectSettings> {
    const { s, unreadable } = await settings()
    if (unreadable) throw new AccessDenied('Project settings file is unreadable')
    return s
  }

  async function writable(relPath: string): Promise<{ canonical: string; s: ProjectSettings }> {
    const canonical = target(relPath)
    const s = await readableSettings()
    if (isProse(s, canonical)) {
      throw new AccessDenied(`Prose is never edited by the AI: ${relPath}`)
    }
    return { canonical, s }
  }

  async function checkWrite(relPath: string): Promise<string> {
    const { canonical, s } = await writable(relPath)
    const a = effectiveAccess(s, canonical)
    if (a === 'hidden') {
      throw new AccessDenied(`The writer has hidden this file from the AI: ${relPath}`)
    }
    if (a !== 'edit') throw new AccessDenied(`The AI may only read this file: ${relPath}`)
    if ((await kind(resolveInside(root, canonical))) !== 'file') throw notAvailable(relPath)
    return canonical
  }

  async function checkCreate(relPath: string): Promise<string> {
    const { canonical, s } = await writable(relPath)
    const folder = canonical.includes('/') ? canonical.slice(0, canonical.lastIndexOf('/')) : ''
    if (effectiveAccess(s, folder) !== 'edit') {
      throw new AccessDenied(
        `The AI may not create files in this folder: ${folder || "the project's top level"}`
      )
    }
    const full = resolveInside(root, canonical)
    if ((await kind(path.dirname(full))) !== 'folder') throw notAvailable(relPath)
    if ((await kind(full)) !== null) throw new AccessDenied(`File already exists: ${relPath}`)
    return canonical
  }

  return {
    canonicalize,

    async list() {
      const { s, unreadable } = await settings()
      if (unreadable) return []
      const out: AiFile[] = []
      for (const relPath of flattenFiles(await listTree(root))) {
        const a = effectiveAccess(s, relPath)
        if (a !== 'hidden') out.push({ relPath, access: a })
      }
      return out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
    },

    async read(relPath) {
      const canonical = target(relPath)
      const s = await readableSettings()
      if (effectiveAccess(s, canonical) === 'hidden') {
        throw new AccessDenied(`The writer has hidden this file from the AI: ${relPath}`)
      }
      if ((await kind(resolveInside(root, canonical))) !== 'file') throw notAvailable(relPath)
      return readDoc(root, canonical)
    },

    checkWrite,
    checkCreate,

    async write(relPath, content) {
      const canonical = await checkWrite(relPath)
      return writeDoc(root, canonical, content)
    },

    async create(relPath, content) {
      const canonical = await checkCreate(relPath)
      const full = resolveInside(root, canonical)
      // Reserve the name exclusively so a file that appears meanwhile is never
      // overwritten, then fill it through the normal atomic write.
      try {
        await (await fsp.open(full, 'wx')).close()
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new AccessDenied(`File already exists: ${relPath}`)
        }
        throw err
      }
      try {
        return await writeDoc(root, canonical, content)
      } catch (err) {
        await fsp.rm(full, { force: true })
        throw err
      }
    }
  }
}
