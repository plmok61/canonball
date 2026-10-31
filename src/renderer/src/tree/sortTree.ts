import type { TreeNode } from '../../../shared/types'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortTree(nodes: TreeNode[]): TreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return collator.compare(a.name, b.name)
    })
    .map((n) => (n.children ? { ...n, children: sortTree(n.children) } : n))
}
