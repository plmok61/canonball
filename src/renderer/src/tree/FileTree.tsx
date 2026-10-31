import { useState } from 'react'
import type { Access, ProjectSettings, TreeNode } from '../../../shared/types'
import { displayName } from '../../../shared/paths'
import { ACCESS_BADGE, effectiveAccess, isExplicit, isProse } from '../../../shared/access'

interface Props {
  tree: TreeNode[]
  selected: string | null
  onOpen(relPath: string): void
  settings: ProjectSettings
  onCycle(relPath: string): void
}

const ACCESS_ORDER: Access[] = ['edit', 'read', 'hidden']

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

function Badge({
  relPath,
  settings,
  onCycle
}: {
  relPath: string
  settings: ProjectSettings
  onCycle(relPath: string): void
}): React.JSX.Element {
  const { glyph, label } = ACCESS_BADGE[effectiveAccess(settings, relPath)]
  return (
    <button
      type="button"
      className={isExplicit(settings, relPath) ? 'cb-badge' : 'cb-badge cb-badge-inherited'}
      aria-label={`${label}. Click to change.`}
      title={label}
      onClick={() => onCycle(relPath)}
    >
      {glyph}
    </button>
  )
}

function Rows({
  nodes,
  depth,
  selected,
  onOpen,
  collapsed,
  toggle,
  settings,
  onCycle
}: {
  nodes: TreeNode[]
  depth: number
  selected: string | null
  onOpen(relPath: string): void
  collapsed: Set<string>
  toggle(relPath: string): void
  settings: ProjectSettings
  onCycle(relPath: string): void
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
                  {isProse(settings, n.relPath) && <span className="cb-prose-tag">prose</span>}
                </button>
                <Badge relPath={n.relPath} settings={settings} onCycle={onCycle} />
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
                    onCycle={onCycle}
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
                {isProse(settings, n.relPath) && <span className="cb-prose-tag">prose</span>}
              </button>
              <Badge relPath={n.relPath} settings={settings} onCycle={onCycle} />
            </div>
          </div>
        )
      })}
    </>
  )
}

export function FileTree({ tree, selected, onOpen, settings, onCycle }: Props): React.JSX.Element {
  // Holds toggled folders: for top-level means "collapsed", for nested means "expanded".
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const toggle = (relPath: string): void =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })
  return (
    <>
      <div role="tree" aria-label="Project files">
        <Rows
          nodes={tree}
          depth={0}
          selected={selected}
          onOpen={onOpen}
          collapsed={toggled}
          toggle={toggle}
          settings={settings}
          onCycle={onCycle}
        />
      </div>
      <ul className="cb-legend" aria-label="AI access">
        {ACCESS_ORDER.map((a) => (
          <li key={a}>
            <span aria-hidden="true">{ACCESS_BADGE[a].glyph}</span> {ACCESS_BADGE[a].label}
          </li>
        ))}
      </ul>
    </>
  )
}
