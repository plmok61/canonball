import { useState } from 'react'
import type { ProtectionSettings, TreeNode } from '../../../shared/types'
import { displayName } from '../../../shared/paths'
import { isProtected } from '../../../shared/protection'

interface Props {
  tree: TreeNode[]
  selected: string | null
  onOpen(relPath: string): void
  settings: ProtectionSettings
}

const rowStyle = (depth: number): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  padding: `3px 8px 3px ${8 + depth * 14}px`
})

const mainStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  font: '13px -apple-system, system-ui, sans-serif',
  textAlign: 'left',
  cursor: 'pointer'
}

function Rows({
  nodes,
  depth,
  selected,
  onOpen,
  collapsed,
  toggle,
  settings
}: {
  nodes: TreeNode[]
  depth: number
  selected: string | null
  onOpen(relPath: string): void
  collapsed: Set<string>
  toggle(relPath: string): void
  settings: ProtectionSettings
}): React.JSX.Element {
  return (
    <>
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          // Top-level folders start expanded; deeper ones start collapsed.
          const open = depth === 0 ? !collapsed.has(n.relPath) : collapsed.has(n.relPath)
          return (
            <div key={n.relPath} role="treeitem" aria-expanded={open}>
              <div className="cb-row" style={rowStyle(depth)}>
                <button type="button" style={mainStyle} onClick={() => toggle(n.relPath)}>
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <span>{n.name}</span>
                  {isProtected(settings, n.relPath) && (
                    <span className="cb-protected-tag">protected</span>
                  )}
                </button>
              </div>
              {open && (
                <div role="group">
                  <Rows
                    nodes={n.children ?? []}
                    depth={depth + 1}
                    selected={selected}
                    onOpen={onOpen}
                    collapsed={collapsed}
                    toggle={toggle}
                    settings={settings}
                  />
                </div>
              )}
            </div>
          )
        }
        const isSel = n.relPath === selected
        return (
          <div key={n.relPath} role="treeitem" aria-selected={isSel}>
            <div className={isSel ? 'cb-row cb-row-selected' : 'cb-row'} style={rowStyle(depth)}>
              <button type="button" style={mainStyle} onClick={() => onOpen(n.relPath)}>
                <span>{displayName(n.name)}</span>
                {isProtected(settings, n.relPath) && (
                  <span className="cb-protected-tag">protected</span>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

export function FileTree({ tree, selected, onOpen, settings }: Props): React.JSX.Element {
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
        settings={settings}
      />
    </div>
  )
}
