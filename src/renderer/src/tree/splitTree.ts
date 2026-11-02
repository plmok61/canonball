import type { TreeNode } from '../../../shared/types'

export interface ProtectedRoot {
  node: TreeNode
  parentPath: string
}

/** Pulls each protected entry out of the (sorted) tree; the rest stays in place. */
export function splitTree(
  tree: TreeNode[],
  protectedPaths: string[]
): { protectedRoots: ProtectedRoot[]; rest: TreeNode[] } {
  const wanted = new Set(protectedPaths)
  const protectedRoots: ProtectedRoot[] = []
  const walk = (nodes: TreeNode[], parentPath: string): TreeNode[] => {
    const kept: TreeNode[] = []
    for (const n of nodes) {
      if (wanted.has(n.relPath)) {
        protectedRoots.push({ node: n, parentPath })
      } else if (n.children) {
        kept.push({ ...n, children: walk(n.children, n.relPath) })
      } else {
        kept.push(n)
      }
    }
    return kept
  }
  const rest = walk(tree, '')
  return { protectedRoots, rest }
}
