import { randomUUID } from 'crypto'
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import type { DocFile, TreeNode } from '../shared/types'

const ESCAPE_MSG = 'Path escapes project'

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function resolveInside(root: string, relPath: string): string {
  if (path.isAbsolute(relPath)) throw new Error(ESCAPE_MSG)
  const target = path.resolve(root, relPath)
  if (!isInside(path.resolve(root), target)) throw new Error(ESCAPE_MSG)

  // Follow symlinks: resolve the deepest existing ancestor and re-check.
  const realRoot = fs.realpathSync(root)
  let existing = target
  while (!fs.existsSync(existing)) existing = path.dirname(existing)
  const realExisting = fs.realpathSync(existing)
  if (!isInside(realRoot, realExisting)) throw new Error(ESCAPE_MSG)
  return target
}

/**
 * The root a renderer call is allowed to touch: the project it believes is open
 * must still be the open project, so a save queued in project A can never land
 * in project B after a switch.
 */
export function requireCurrentRoot(current: string | null, claimed: string): string {
  if (!current) throw new Error('No project open')
  if (claimed !== current) throw new Error('Project changed')
  return current
}

export async function listTree(root: string, rel = ''): Promise<TreeNode[]> {
  const dir = rel ? path.join(root, rel) : root
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      nodes.push({ name: entry.name, relPath, kind: 'folder', children: await listTree(root, relPath) })
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      nodes.push({ name: entry.name, relPath, kind: 'file' })
    }
  }
  return nodes
}

export async function readDoc(root: string, relPath: string): Promise<DocFile> {
  const full = resolveInside(root, relPath)
  const [content, stat] = await Promise.all([fsp.readFile(full, 'utf8'), fsp.stat(full)])
  return { content, mtimeMs: stat.mtimeMs }
}

export async function writeDoc(root: string, relPath: string, content: string): Promise<DocFile> {
  const full = resolveInside(root, relPath)
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${randomUUID()}.tmp`)
  try {
    await fsp.writeFile(tmp, content, 'utf8')
    await fsp.rename(tmp, full)
  } catch (err) {
    await fsp.rm(tmp, { force: true })
    throw err
  }
  const stat = await fsp.stat(full)
  return { content, mtimeMs: stat.mtimeMs }
}

export async function createProject(targetDir: string, templateDir: string): Promise<void> {
  try {
    const existing = await fsp.readdir(targetDir)
    if (existing.length > 0) throw new Error('Folder is not empty')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  await fsp.mkdir(targetDir, { recursive: true })
  await fsp.cp(templateDir, targetDir, { recursive: true })
  await fsp.writeFile(path.join(targetDir, '.gitignore'), '.canonball/chats/\n', 'utf8')
}
