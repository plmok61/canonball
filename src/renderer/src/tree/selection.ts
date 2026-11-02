import type { TreeNode } from '../../../shared/types'

export interface Selection {
  paths: string[]
  anchor: string | null
}

/** Rows top to bottom as rendered: protected roots first, then the rest. */
export function visibleOrder(
  protectedRoots: TreeNode[],
  rest: TreeNode[],
  isOpen: (relPath: string, depth: number) => boolean
): string[] {
  const out: string[] = []
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const n of nodes) {
      out.push(n.relPath)
      if (n.kind === 'folder' && isOpen(n.relPath, depth)) walk(n.children ?? [], depth + 1)
    }
  }
  walk(protectedRoots, 0)
  walk(rest, 0)
  return out
}

function range(order: string[], a: string, b: string): string[] | null {
  const i = order.indexOf(a)
  const j = order.indexOf(b)
  if (i < 0 || j < 0) return null
  return order.slice(Math.min(i, j), Math.max(i, j) + 1)
}

export function clickSelect(
  sel: Selection,
  relPath: string,
  mods: { meta: boolean; shift: boolean },
  order: string[]
): Selection {
  if (mods.shift && sel.anchor) {
    const paths = range(order, sel.anchor, relPath)
    if (paths) return { paths, anchor: sel.anchor }
  }
  if (mods.meta) {
    const paths = sel.paths.includes(relPath)
      ? sel.paths.filter((p) => p !== relPath)
      : [...sel.paths, relPath]
    return { paths, anchor: relPath }
  }
  return { paths: [relPath], anchor: relPath }
}

export function arrowSelect(
  sel: Selection,
  dir: 1 | -1,
  shift: boolean,
  order: string[]
): Selection {
  if (order.length === 0) return sel
  const current = sel.paths.length ? sel.paths[sel.paths.length - 1] : null
  const at = current === null ? -1 : order.indexOf(current)
  const next =
    at < 0 ? (dir === 1 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + dir))
  const target = order[next]
  if (shift && sel.anchor) {
    const paths = range(order, sel.anchor, target)
    if (paths) return { paths, anchor: sel.anchor }
  }
  return { paths: [target], anchor: target }
}
