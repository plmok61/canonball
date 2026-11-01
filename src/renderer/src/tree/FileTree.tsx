import { useState } from 'react'
import type { TreeNode } from '../../../shared/types'
import { displayName } from '../../../shared/paths'
import { ChevronDown, ChevronRight } from '../icons'
import { splitTree } from './splitTree'

interface Props {
  tree: TreeNode[]
  selected: string | null
  onOpen(relPath: string): void
  protectedPaths: string[]
  onRowMenu(relPath: string, inProtected: boolean): void
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
  menu,
  menuDeep,
  parentPath
}: {
  nodes: TreeNode[]
  depth: number
  selected: string | null
  onOpen(relPath: string): void
  collapsed: Set<string>
  toggle(relPath: string): void
  /** Handler for right-click on rows at this level; undefined means none. */
  menu?(relPath: string): void
  /** Whether nested rows keep the right-click handler (Project) or not (inside a protected root). */
  menuDeep?: boolean
  /** Muted parent path shown before each row's name (protected roots only). */
  parentPath?: string
}): React.JSX.Element {
  const onMenu =
    (relPath: string) =>
    (e: React.MouseEvent): void => {
      if (!menu) return
      e.preventDefault()
      menu(relPath)
    }
  return (
    <>
      {nodes.map((n) => {
        if (n.kind === 'folder') {
          // Top-level folders start expanded; deeper ones start collapsed.
          const open = depth === 0 ? !collapsed.has(n.relPath) : collapsed.has(n.relPath)
          return (
            <div key={n.relPath} role="treeitem" aria-expanded={open}>
              <div className="cb-row" style={rowStyle(depth)} onContextMenu={onMenu(n.relPath)}>
                <button type="button" style={mainStyle} onClick={() => toggle(n.relPath)}>
                  <span aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
                  {parentPath && <span className="cb-row-parent">{parentPath}</span>}
                  <span>{n.name}</span>
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
                    menu={menuDeep ? menu : undefined}
                    menuDeep={menuDeep}
                  />
                </div>
              )}
            </div>
          )
        }
        const isSel = n.relPath === selected
        return (
          <div key={n.relPath} role="treeitem" aria-selected={isSel}>
            <div
              className={isSel ? 'cb-row cb-row-selected' : 'cb-row'}
              style={rowStyle(depth)}
              onContextMenu={onMenu(n.relPath)}
            >
              <button type="button" style={mainStyle} onClick={() => onOpen(n.relPath)}>
                {parentPath && <span className="cb-row-parent">{parentPath}</span>}
                <span>{displayName(n.name)}</span>
              </button>
            </div>
          </div>
        )
      })}
    </>
  )
}

export function FileTree({
  tree,
  selected,
  onOpen,
  protectedPaths,
  onRowMenu
}: Props): React.JSX.Element {
  // Holds toggled folders: for top-level means "collapsed", for nested means "expanded".
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const toggle = (relPath: string): void =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })
  const { protectedRoots, rest } = splitTree(tree, protectedPaths)
  return (
    <>
      <section aria-label="Protected">
        <h2 className="cb-tree-heading">Protected</h2>
        <p className="cb-tree-caption">AI can read, never edit</p>
        <div role="tree" aria-label="Protected files">
          {protectedRoots.map(({ node, parentPath }) => (
            <Rows
              key={node.relPath}
              nodes={[node]}
              depth={0}
              selected={selected}
              onOpen={onOpen}
              collapsed={toggled}
              toggle={toggle}
              menu={(p) => onRowMenu(p, true)}
              parentPath={parentPath}
            />
          ))}
        </div>
        {protectedRoots.length === 0 && (
          <p className="cb-tree-hint">Right-click a folder or file to protect it from AI edits.</p>
        )}
      </section>
      <section aria-label="Project">
        <div role="tree" aria-label="Project files">
          <Rows
            nodes={rest}
            depth={0}
            selected={selected}
            onOpen={onOpen}
            collapsed={toggled}
            toggle={toggle}
            menu={(p) => onRowMenu(p, false)}
            menuDeep
          />
        </div>
      </section>
    </>
  )
}
