import type { EntryKind } from '../../../shared/types'
import { isAtOrUnder, topmost } from '../../../shared/fileNames'

/** The internal drag data type. Drops without it (Finder files, text) are ignored. */
export const DRAG_TYPE = 'application/x-canonball-paths'

/** What the pointer is over: a row, or `relPath: null` for the empty space of a section. */
export interface DropOver {
  relPath: string | null
  kind: EntryKind | null
}

export interface DragHandlers {
  onDragStart(relPath: string): void
  /** True when dropping here is allowed. */
  onDragOver(target: DropOver, copy: boolean): boolean
  onDrop(target: DropOver, copy: boolean): void
  onDragEnd(): void
}

const parentOf = (relPath: string): string =>
  relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''

/**
 * The folder a drop would land in (`''` for the top level), or null when it isn't
 * allowed: a folder onto itself or its own descendant, or (for a move, not a copy) every
 * item already there. Copying into the items' own folder duplicates, as paste does.
 * A file target means its parent folder.
 */
export function dropTarget(dragged: string[], over: DropOver, copy = false): string | null {
  const items = topmost(dragged)
  if (items.length === 0) return null
  const dest =
    over.relPath === null ? '' : over.kind === 'folder' ? over.relPath : parentOf(over.relPath)
  if (items.some((p) => isAtOrUnder(dest, p))) return null
  if (!copy && items.every((p) => parentOf(p) === dest)) return null
  return dest
}
