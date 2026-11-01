import { useState } from 'react'
import type { EntryKind, Move, TreeNode } from '../../../shared/types'
import { remapPath } from '../../../shared/fileNames'
import { displayName } from '../../../shared/paths'
import { ChevronDown, ChevronRight } from '../icons'
import { splitTree } from './splitTree'
import { NameEditor } from './NameEditor'
import { clickSelect, visibleOrder, type Selection } from './selection'

export type EditingState =
  { mode: 'rename'; relPath: string } | { mode: 'new'; kind: EntryKind; parentRel: string } | null

export interface MenuTarget {
  relPath: string | null
  inProtectedRoot: boolean
}

interface Props {
  tree: TreeNode[]
  protectedPaths: string[]
  selection: Selection
  /** `open` is given when the click should also open that file. */
  onSelect(next: Selection, open?: string): void
  onMenu(target: MenuTarget): void
  onKey(e: React.KeyboardEvent): void
  onFocusChange(focused: boolean): void
  cutPaths: string[]
  editing: EditingState
  onEditSubmit(name: string): Promise<string | null>
  onEditCancel(): void
  /** Moves from the latest action; collapse state follows them. */
  moves: Move[]
  /** Folders to show open; a new array (from the latest action) opens them. */
  expand?: string[]
}

const NO_EXPAND: string[] = []

/** Everything the rows share. */
interface Ctx {
  selected: Set<string>
  cut: Set<string>
  editing: EditingState
  onEditSubmit(name: string): Promise<string | null>
  onEditCancel(): void
  isOpen(relPath: string, depth: number): boolean
  toggle(relPath: string): void
  click(relPath: string, e: React.MouseEvent, kind: EntryKind): void
  menu(relPath: string, inProtectedRoot: boolean): (e: React.MouseEvent) => void
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
  ctx,
  root,
  parentPath
}: {
  nodes: TreeNode[]
  depth: number
  ctx: Ctx
  /** True for the root rows of the Protected section. */
  root?: boolean
  /** Muted parent path shown before each row's name (protected roots only). */
  parentPath?: string
}): React.JSX.Element {
  const { editing } = ctx
  const rowClass = (relPath: string): string =>
    ['cb-row', ctx.selected.has(relPath) && 'cb-row-selected', ctx.cut.has(relPath) && 'cb-row-cut']
      .filter(Boolean)
      .join(' ')
  return (
    <>
      {nodes.map((n) => {
        const renaming = editing?.mode === 'rename' && editing.relPath === n.relPath
        const label = renaming ? (
          <NameEditor
            initial={n.kind === 'file' ? n.name.replace(/\.md$/i, '') : n.name}
            selectStem
            onSubmit={ctx.onEditSubmit}
            onCancel={ctx.onEditCancel}
          />
        ) : null
        if (n.kind === 'folder') {
          const open = ctx.isOpen(n.relPath, depth)
          return (
            <div key={n.relPath} role="treeitem" aria-expanded={open} data-path={n.relPath}>
              <div
                className={rowClass(n.relPath)}
                style={rowStyle(depth)}
                onContextMenu={ctx.menu(n.relPath, !!root)}
              >
                {label ?? (
                  <button
                    type="button"
                    style={mainStyle}
                    onClick={(e) => ctx.click(n.relPath, e, 'folder')}
                  >
                    <span aria-hidden="true">{open ? <ChevronDown /> : <ChevronRight />}</span>
                    {parentPath && <span className="cb-row-parent">{parentPath}</span>}
                    <span>{n.name}</span>
                  </button>
                )}
              </div>
              {open && (
                <div role="group">
                  {editing?.mode === 'new' && editing.parentRel === n.relPath && (
                    <NewRow ctx={ctx} depth={depth + 1} />
                  )}
                  <Rows nodes={n.children ?? []} depth={depth + 1} ctx={ctx} />
                </div>
              )}
            </div>
          )
        }
        return (
          <div
            key={n.relPath}
            role="treeitem"
            aria-selected={ctx.selected.has(n.relPath)}
            data-path={n.relPath}
          >
            <div
              className={rowClass(n.relPath)}
              style={rowStyle(depth)}
              onContextMenu={ctx.menu(n.relPath, !!root)}
            >
              {label ?? (
                <button
                  type="button"
                  style={mainStyle}
                  onClick={(e) => ctx.click(n.relPath, e, 'file')}
                >
                  {parentPath && <span className="cb-row-parent">{parentPath}</span>}
                  <span>{displayName(n.name)}</span>
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

function NewRow({ ctx, depth }: { ctx: Ctx; depth: number }): React.JSX.Element {
  return (
    <div className="cb-row" style={rowStyle(depth)}>
      <NameEditor
        initial=""
        selectStem={false}
        onSubmit={ctx.onEditSubmit}
        onCancel={ctx.onEditCancel}
      />
    </div>
  )
}

/** `a/b/c` gives `a`, `a/b`, `a/b/c`. */
function withAncestors(relPath: string): string[] {
  const parts = relPath.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function FileTree({
  tree,
  protectedPaths,
  selection,
  onSelect,
  onMenu,
  onKey,
  onFocusChange,
  cutPaths,
  editing,
  onEditSubmit,
  onEditCancel,
  moves,
  expand = NO_EXPAND
}: Props): React.JSX.Element {
  // Holds toggled folders: for top-level means "collapsed", for nested means "expanded".
  const [toggled, setToggled] = useState<Set<string>>(new Set())
  const [seenMoves, setSeenMoves] = useState<Move[]>(moves)
  if (moves !== seenMoves) {
    // Follow renames and moves so expanded folders stay expanded.
    setSeenMoves(moves)
    if (moves.length > 0) {
      setToggled((prev) => new Set([...prev].map((p) => moves.reduce(remapPath, p))))
    }
  }
  const { protectedRoots, rest } = splitTree(tree, protectedPaths)
  const [seenExpand, setSeenExpand] = useState<string[]>(expand)
  if (expand !== seenExpand) {
    setSeenExpand(expand)
    if (expand.length > 0) {
      // Top-level rows are open unless toggled; nested ones are open only when toggled.
      const top = new Set([
        ...protectedRoots.map((r) => r.node.relPath),
        ...rest.map((n) => n.relPath)
      ])
      setToggled((prev) => {
        const next = new Set(prev)
        for (const p of expand) {
          if (top.has(p)) next.delete(p)
          else next.add(p)
        }
        return next
      })
    }
  }
  const toggle = (relPath: string): void =>
    setToggled((prev) => {
      const next = new Set(prev)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })
  // A folder getting a new entry is shown open.
  const forced = new Set(
    editing?.mode === 'new' && editing.parentRel !== '' ? withAncestors(editing.parentRel) : []
  )
  const isOpen = (relPath: string, depth: number): boolean =>
    forced.has(relPath) || (depth === 0 ? !toggled.has(relPath) : toggled.has(relPath))
  const order = visibleOrder(
    protectedRoots.map((r) => r.node),
    rest,
    isOpen
  )
  const ctx: Ctx = {
    selected: new Set(selection.paths),
    cut: new Set(cutPaths),
    editing,
    onEditSubmit,
    onEditCancel,
    isOpen,
    toggle,
    click: (relPath, e, kind) => {
      const mods = { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey }
      const next = clickSelect(selection, relPath, mods, order)
      const plain = !mods.meta && !mods.shift
      if (kind === 'folder') {
        if (plain) toggle(relPath)
        onSelect(next)
      } else {
        onSelect(next, plain ? relPath : undefined)
      }
    },
    menu: (relPath, inProtectedRoot) => (e) => {
      e.preventDefault()
      e.stopPropagation()
      onMenu({ relPath, inProtectedRoot })
    }
  }
  return (
    <div
      className="cb-tree-scroll"
      role="group"
      aria-label="Files"
      tabIndex={0}
      onKeyDown={onKey}
      onFocus={() => onFocusChange(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocusChange(false)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu({ relPath: null, inProtectedRoot: false })
      }}
    >
      <section aria-label="Protected" className="cb-tree-protected">
        <h2 className="cb-tree-heading">Protected</h2>
        <p className="cb-tree-caption">AI can read, never edit</p>
        <div role="tree" aria-label="Protected files">
          {protectedRoots.map(({ node, parentPath }) => (
            <Rows
              key={node.relPath}
              nodes={[node]}
              depth={0}
              ctx={ctx}
              root
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
          {editing?.mode === 'new' && editing.parentRel === '' && <NewRow ctx={ctx} depth={0} />}
          <Rows nodes={rest} depth={0} ctx={ctx} />
        </div>
      </section>
    </div>
  )
}
