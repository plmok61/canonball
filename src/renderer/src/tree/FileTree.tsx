import { useState } from 'react'
import type { TreeNode } from '../../../shared/types'
import { displayName } from '../../../shared/paths'

interface Props {
  tree: TreeNode[]
  selected: string | null
  onOpen(relPath: string): void
}

const rowStyle = (depth: number): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: `3px 8px 3px ${8 + depth * 14}px`,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: '13px -apple-system, system-ui, sans-serif',
  textAlign: 'left',
  cursor: 'pointer'
})

function Rows({
  nodes,
  depth,
  selected,
  onOpen,
  collapsed,
  toggle
}: {
  nodes: TreeNode[]
  depth: number
  selected: string | null
  onOpen(relPath: string): void
  collapsed: Set<string>
  toggle(relPath: string): void
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          // Top-level folders start expanded; deeper ones start collapsed.
          const open = depth === 0 ? !collapsed.has(n.relPath) : collapsed.has(n.relPath)
          return (
            <div key={n.relPath} role="treeitem" aria-expanded={open}>
              <button
                type="button"
                className="cb-row"
                style={rowStyle(depth)}
                onClick={() => toggle(n.relPath)}
              >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span style={{ flex: 1 }}>{n.name}</span>
                <span className="cb-badge-slot" />
              </button>
              {open && (
                <div role="group">
                  <Rows
                    nodes={n.children ?? []}
                    depth={depth + 1}
                    selected={selected}
                    onOpen={onOpen}
                    collapsed={collapsed}
                    toggle={toggle}
                  />
                </div>
              )}
            </div>
          )
        }
        const isSel = n.relPath === selected
        return (
          <div key={n.relPath} role="treeitem" aria-selected={isSel}>
            <button
              type="button"
              className={isSel ? 'cb-row cb-row-selected' : 'cb-row'}
              style={rowStyle(depth)}
              onClick={() => onOpen(n.relPath)}
            >
              <span style={{ flex: 1 }}>{displayName(n.name)}</span>
              <span className="cb-badge-slot" />
            </button>
          </div>
        )
      })}
    </>
  )
}

export function FileTree({ tree, selected, onOpen }: Props): React.JSX.Element {
  // Holds toggled folders: for top-level means "collapsed", for nested means "expanded".
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const toggle = (relPath: string): void =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })
  return (
    <div role="tree" aria-label="Project files">
      <Rows
        nodes={tree}
        depth={0}
        selected={selected}
        onOpen={onOpen}
        collapsed={toggled}
        toggle={toggle}
      />
    </div>
  )
}
