import { randomUUID } from 'crypto'
import { promises as fsp } from 'fs'
import path from 'path'
import { copyName, isAtOrUnder, nameError, remapPath, topmost, withMd } from '../shared/fileNames'
import { remapProtected, validPath } from '../shared/protection'
import type { EntryKind, FileOpResult, Move, TrashedItem } from '../shared/types'
import { listTree, resolveInside } from './projectFs'
import { applyProtectionDelta, loadProjectProtection, remapProtection } from './projectSettings'

const TRASH_REL = '.canonball/trash'
const INTO_ITSELF = "Can't move a folder into itself."
const TRASH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const alreadyExists = (rel: string): Error =>
  new Error(`"${path.posix.basename(rel)}" already exists`)
const gone = (rel: string): Error => new Error(`"${path.posix.basename(rel)}" no longer exists`)

/** A writer-visible project path: valid, no dot-segment, no `node_modules`. */
export function checkedPath(root: string, rel: string): string {
  if (
    !validPath(rel) ||
    rel.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules')
  ) {
    throw new Error('Invalid path')
  }
  return resolveInside(root, rel)
}

/** Like `checkedPath`, but `''` means the project's top level. */
function checkedFolder(root: string, rel: string): string {
  return rel === '' ? resolveInside(root, '') : checkedPath(root, rel)
}

function checkedName(name: string): void {
  const err = nameError(name)
  if (err) throw new Error(err)
}

const parentOf = (rel: string): string => {
  const dir = path.posix.dirname(rel)
  return dir === '.' ? '' : dir
}

const join = (parentRel: string, name: string): string =>
  parentRel ? `${parentRel}/${name}` : name

const holdingRel = (id: string, from: string): string =>
  `${TRASH_REL}/${id}/${path.posix.basename(from)}`

async function exists(full: string): Promise<boolean> {
  try {
    await fsp.lstat(full)
    return true
  } catch {
    return false
  }
}

async function kindOf(full: string, rel: string): Promise<EntryKind> {
  try {
    return (await fsp.lstat(full)).isDirectory() ? 'folder' : 'file'
  } catch {
    throw gone(rel)
  }
}

/** True when `to` is taken by something other than `from` (a case-only rename sees itself). */
async function takenBy(from: string, to: string): Promise<boolean> {
  let target
  try {
    target = await fsp.lstat(to)
  } catch {
    return false
  }
  if (from.toLowerCase() !== to.toLowerCase()) return true
  try {
    const source = await fsp.lstat(from)
    return !(source.ino === target.ino && source.dev === target.dev)
  } catch {
    return true
  }
}

/** Names in a folder, lower-cased so a case-insensitive disk never clashes. */
async function namesIn(dirFull: string): Promise<Set<string>> {
  return new Set((await fsp.readdir(dirFull)).map((n) => n.toLowerCase()))
}

/** One rename that never overwrites. A case-only change goes through a temporary name. */
async function moveOne(root: string, m: Move): Promise<void> {
  const from = resolveInside(root, m.from)
  const to = resolveInside(root, m.to)
  if (await takenBy(from, to)) throw alreadyExists(m.to)
  if (from !== to && from.toLowerCase() === to.toLowerCase()) {
    const tmp = path.join(path.dirname(from), `.${path.basename(from)}.${randomUUID()}.tmp`)
    await fsp.rename(from, tmp)
    await fsp.rename(tmp, to)
    return
  }
  await fsp.rename(from, to)
}

/**
 * Protected entries a move folds away: moved entries (at or under a `from`)
 * whose new path normalize drops because a protected entry already covers
 * it. Reported as they were, at their old paths, so an undo can put them back.
 */
function foldedBy(pre: string[], moves: Move[]): string[] {
  const after = remapProtected(pre, moves)
  return pre.filter(
    (p) =>
      moves.some((m) => isAtOrUnder(p, m.from)) &&
      !after.includes(moves.reduce((acc, m) => remapPath(acc, m), p))
  )
}

/**
 * Moves with protection kept in step: entries are added at the new paths
 * (plus any `restore` entries) before anything moves, and the old ones
 * dropped after, so nothing is ever unprotected mid-move. On a failure,
 * completed moves keep their protection and entries added for moves that
 * didn't happen are dropped. Returns the entries the move folded away.
 */
async function movesWithProtection(
  root: string,
  moves: Move[],
  restore: string[] = []
): Promise<string[]> {
  if (moves.length === 0) return []
  const pre = (await loadProjectProtection(root)).settings.protected
  await remapProtection(root, moves, 'before', restore)
  const done: Move[] = []
  try {
    for (const m of moves) {
      await moveOne(root, m)
      done.push(m)
    }
  } catch (err) {
    try {
      await remapProtection(root, done, 'after')
      const undone = moves.filter((m) => !done.includes(m))
      const stale = [
        ...remapProtected(pre, undone),
        ...restore.filter((p) => undone.some((m) => isAtOrUnder(p, m.to)))
      ].filter((p) => !pre.includes(p))
      if (stale.length > 0) await applyProtectionDelta(root, { added: [], removed: stale })
    } catch {
      // Leaving an extra protected entry is the safe failure.
    }
    throw err
  }
  await remapProtection(root, moves, 'after')
  return foldedBy(pre, moves)
}

async function result<T extends object>(root: string, extra: T): Promise<FileOpResult & T> {
  const [tree, protection] = await Promise.all([listTree(root), loadProjectProtection(root)])
  return { ...extra, tree, protection }
}

export async function createEntry(
  root: string,
  kind: EntryKind,
  parentRel: string,
  name: string
): Promise<FileOpResult & { relPath: string }> {
  checkedName(name)
  checkedFolder(root, parentRel)
  const finalName = kind === 'file' ? withMd(name) : name
  const relPath = join(parentRel, finalName)
  const full = checkedPath(root, relPath)
  if (await exists(full)) throw alreadyExists(relPath)
  try {
    if (kind === 'file') await fsp.writeFile(full, '', { flag: 'wx' })
    else await fsp.mkdir(full)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw alreadyExists(relPath)
    throw err
  }
  return result(root, { relPath })
}

/** Files keep `.md`: the caller passes the name without it. */
export async function renameEntry(
  root: string,
  relPath: string,
  newName: string
): Promise<FileOpResult & { move: Move; folded: string[] }> {
  const full = checkedPath(root, relPath)
  checkedName(newName)
  const kind = await kindOf(full, relPath)
  const to = join(parentOf(relPath), kind === 'file' ? withMd(newName) : newName)
  checkedPath(root, to)
  const move = { from: relPath, to }
  let folded: string[] = []
  if (to !== relPath) {
    if (await takenBy(full, resolveInside(root, to))) throw alreadyExists(to)
    folded = await movesWithProtection(root, [move])
  }
  return result(root, { move, folded })
}

export async function pasteEntries(
  root: string,
  mode: 'copy' | 'move',
  relPaths: string[],
  destRel: string
): Promise<FileOpResult & { created: string[]; moves: Move[]; folded: string[] }> {
  const destFull = checkedFolder(root, destRel)
  if (!(await fsp.stat(destFull)).isDirectory()) throw new Error('Not a folder')
  const items: { rel: string; kind: EntryKind }[] = []
  for (const rel of topmost(relPaths)) {
    const kind = await kindOf(checkedPath(root, rel), rel)
    if (kind === 'folder' && destRel !== '' && isAtOrUnder(destRel, rel)) {
      throw new Error(INTO_ITSELF)
    }
    items.push({ rel, kind })
  }
  const names = await namesIn(destFull)
  const plan: Move[] = []
  for (const { rel, kind } of items) {
    if (mode === 'move' && parentOf(rel) === destRel) continue
    const name = copyName(path.posix.basename(rel), kind, (c) => names.has(c.toLowerCase()))
    names.add(name.toLowerCase())
    plan.push({ from: rel, to: join(destRel, name) })
  }
  if (mode === 'move') {
    const folded = await movesWithProtection(root, plan)
    return result(root, { created: [], moves: plan, folded })
  }
  const created: string[] = []
  for (const m of plan) {
    await copyOne(root, m)
    created.push(m.to)
  }
  return result(root, { created, moves: [], folded: [] })
}

async function copyOne(root: string, m: Move): Promise<void> {
  await fsp.cp(resolveInside(root, m.from), resolveInside(root, m.to), {
    recursive: true,
    errorOnExist: true,
    force: false
  })
}

export async function duplicateEntries(
  root: string,
  relPaths: string[]
): Promise<FileOpResult & { created: string[] }> {
  const created: string[] = []
  for (const rel of topmost(relPaths)) {
    const kind = await kindOf(checkedPath(root, rel), rel)
    const parent = parentOf(rel)
    const names = await namesIn(checkedFolder(root, parent))
    const name = copyName(path.posix.basename(rel), kind, (c) => names.has(c.toLowerCase()))
    const to = join(parent, name)
    await copyOne(root, { from: rel, to })
    created.push(to)
  }
  return result(root, { created })
}

/**
 * Moves exactly as given, refusing before anything moves if a target is taken.
 * Undo and redo use it. `restoreProtected` (from an undo) puts back entries the
 * original move folded away; each must lie at or under a path an item moves to.
 */
export async function moveExact(
  root: string,
  moves: Move[],
  restoreProtected: string[] = []
): Promise<FileOpResult & { folded: string[] }> {
  const targets = new Set<string>()
  for (const m of moves) {
    const from = checkedPath(root, m.from)
    const to = checkedPath(root, m.to)
    if (m.to !== m.from && isAtOrUnder(m.to, m.from)) throw new Error(INTO_ITSELF)
    if (!(await exists(from))) throw gone(m.from)
    if (targets.has(m.to.toLowerCase()) || (await takenBy(from, to))) throw alreadyExists(m.to)
    targets.add(m.to.toLowerCase())
  }
  for (const p of restoreProtected) {
    checkedPath(root, p)
    if (!moves.some((m) => isAtOrUnder(p, m.to))) throw new Error('Invalid path')
  }
  const folded = await movesWithProtection(
    root,
    moves.filter((m) => m.from !== m.to),
    restoreProtected
  )
  return result(root, { folded })
}

/** Moves each item into `.canonball/trash/<id>/<name>` and drops its protected entries. */
export async function trashEntries(
  root: string,
  relPaths: string[]
): Promise<FileOpResult & { trashed: TrashedItem[] }> {
  const items = topmost(relPaths)
  for (const rel of items) await kindOf(checkedPath(root, rel), rel)
  const fresh = await loadProjectProtection(root)
  if (fresh.unreadable) throw new Error('Project settings file is unreadable')
  const trashed: TrashedItem[] = []
  try {
    for (const from of items) {
      const id = randomUUID()
      const holding = resolveInside(root, holdingRel(id, from))
      await fsp.mkdir(path.dirname(holding), { recursive: true })
      await fsp.rename(resolveInside(root, from), holding)
      trashed.push({
        id,
        from,
        protectedEntries: fresh.settings.protected.filter((p) => isAtOrUnder(p, from))
      })
    }
  } catch (err) {
    // Put back whatever already moved, so a failed trash changes nothing. A
    // put-back that fails leaves that item safe in the holding area; the rest
    // are still put back, and the writer sees the error that stopped the trash.
    for (const t of trashed) {
      try {
        await fsp.rename(resolveInside(root, holdingRel(t.id, t.from)), resolveInside(root, t.from))
        await fsp.rmdir(resolveInside(root, `${TRASH_REL}/${t.id}`)).catch(() => undefined)
      } catch {
        // Kept in `.canonball/trash/`; nothing is lost.
      }
    }
    throw err
  }
  // Removed only after the items are inside `.canonball/`, which is off limits anyway.
  const removed = trashed.flatMap((t) => t.protectedEntries)
  if (removed.length > 0) await applyProtectionDelta(root, { added: [], removed })
  return result(root, { trashed })
}

/** Puts trashed items back, protection first, refusing before anything moves. */
export async function restoreEntries(root: string, items: TrashedItem[]): Promise<FileOpResult> {
  const froms = new Set<string>()
  for (const item of items) {
    if (typeof item.id !== 'string' || !TRASH_ID.test(item.id)) throw new Error('Invalid path')
    const from = checkedPath(root, item.from)
    if (
      !Array.isArray(item.protectedEntries) ||
      !item.protectedEntries.every((p) => validPath(p) && isAtOrUnder(p, item.from))
    ) {
      throw new Error('Invalid path')
    }
    if (froms.has(item.from.toLowerCase()) || (await exists(from))) throw alreadyExists(item.from)
    froms.add(item.from.toLowerCase())
    if (!(await exists(resolveInside(root, holdingRel(item.id, item.from))))) {
      throw new Error("it's already in the Trash")
    }
  }
  const added = items.flatMap((i) => i.protectedEntries)
  if (added.length > 0) await applyProtectionDelta(root, { added, removed: [] })
  for (const item of items) {
    const to = resolveInside(root, item.from)
    if (await exists(to)) throw alreadyExists(item.from)
    await fsp.mkdir(path.dirname(to), { recursive: true })
    await fsp.rename(resolveInside(root, holdingRel(item.id, item.from)), to)
    await fsp.rmdir(resolveInside(root, `${TRASH_REL}/${item.id}`)).catch(() => undefined)
  }
  return result(root, {})
}

/** Undo of a create: the same as trashing, named so the history reads clearly. */
export async function removeCreated(
  root: string,
  relPaths: string[]
): Promise<FileOpResult & { trashed: TrashedItem[] }> {
  return trashEntries(root, relPaths)
}
