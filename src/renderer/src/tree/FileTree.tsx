import { useEffect, useRef, useState } from 'react'
import type { EntryKind, Move, TreeNode } from '../../../shared/types'
import { remapPath } from '../../../shared/fileNames'
import { displayName } from '../../../shared/paths'
import { ChevronDown, ChevronRight } from '../icons'
import { splitTree } from './splitTree'
import { NameEditor } from './NameEditor'
import { DRAG_TYPE, type DragHandlers, type DropOver } from './dragDrop'
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
  drag: DragHandlers
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
  /** The row (or `root:…` section) a drag is over and may drop on. */
  dropOver: string | null
  dragProps(relPath: string, kind: EntryKind, depth: number): React.HTMLAttributes<HTMLDivElement>
}

const HOVER_OPEN_MS = 1000

const isTreeDrag = (e: React.DragEvent): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes(DRAG_TYPE)

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
    [
      'cb-row',
      ctx.selected.has(relPath) && 'cb-row-selected',
      ctx.cut.has(relPath) && 'cb-row-cut',
      ctx.dropOver === relPath && 'cb-row-drop'
    ]
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
                {...ctx.dragProps(n.relPath, 'folder', depth)}
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
              {...ctx.dragProps(n.relPath, 'file', depth)}
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
  expand = NO_EXPAND,
  drag
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
  // Drag and drop: the highlighted row, and the timer that opens a hovered folder.
  const [dropOver, setDropOver] = useState<string | null>(null)
  const [hoverFolder, setHoverFolder] = useState<{ path: string; depth: number } | null>(null)
  const isOpenNow = useRef(isOpen)
  useEffect(() => {
    isOpenNow.current = isOpen
  })
  useEffect(() => {
    if (!hoverFolder) return
    const { path, depth } = hoverFolder
    const timer = setTimeout(() => {
      if (!isOpenNow.current(path, depth)) toggle(path)
    }, HOVER_OPEN_MS)
    return () => clearTimeout(timer)
    // `toggle` only sets state; the timer must not restart on every render.
  }, [hoverFolder])
  const endDrag = (): void => {
    setHoverFolder(null)
    setDropOver(null)
  }
  /** The row to light up: the folder the drop lands in, none for the top level. */
  const lit = (target: DropOver, key: string): string | null =>
    target.relPath === null
      ? key
      : target.kind === 'folder'
        ? target.relPath
        : target.relPath.includes('/')
          ? target.relPath.slice(0, target.relPath.lastIndexOf('/'))
          : null
  const over = (e: React.DragEvent, key: string, target: DropOver, depth?: number): void => {
    if (!isTreeDrag(e)) return
    e.stopPropagation()
    if (!drag.onDragOver(target, !!e.altKey)) {
      if (dropOver === lit(target, key)) endDrag()
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
    setDropOver(lit(target, key))
    const path = target.kind === 'folder' ? target.relPath : null
    setHoverFolder((cur) =>
      path === null ? null : cur?.path === path ? cur : { path, depth: depth ?? 0 }
    )
  }
  const leave = (e: React.DragEvent, key: string | null): void => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setHoverFolder(null)
    setDropOver((cur) => (cur === key ? null : cur))
  }
  const drop = (e: React.DragEvent, target: DropOver): void => {
    if (!isTreeDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    endDrag()
    drag.onDrop(target, !!e.altKey)
  }
  const sectionProps = (key: string): React.HTMLAttributes<HTMLElement> => ({
    onDragOver: (e) => over(e, key, { relPath: null, kind: null }),
    onDragLeave: (e) => leave(e, key),
    onDrop: (e) => drop(e, { relPath: null, kind: null })
  })
  const ctx: Ctx = {
    dropOver,
    dragProps: (relPath, kind, depth) => {
      const target = { relPath, kind }
      return {
        draggable: !editing,
        onDragStart: (e) => {
          if (editing) return e.preventDefault()
          e.stopPropagation()
          e.dataTransfer?.setData(DRAG_TYPE, relPath)
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove'
          drag.onDragStart(relPath)
        },
        onDragEnd: () => {
          endDrag()
          drag.onDragEnd()
        },
        onDragOver: (e) => over(e, relPath, target, depth),
        onDragLeave: (e) => leave(e, lit(target, relPath)),
        onDrop: (e) => drop(e, target)
      }
    },
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
      <section
        aria-label="Protected"
        className={['cb-tree-protected', dropOver === 'root:protected' && 'cb-row-drop']
          .filter(Boolean)
          .join(' ')}
        {...sectionProps('root:protected')}
      >
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
      <section
        aria-label="Project"
        className={dropOver === 'root:project' ? 'cb-row-drop' : undefined}
        {...sectionProps('root:project')}
      >
        <div role="tree" aria-label="Project files">
          {editing?.mode === 'new' && editing.parentRel === '' && <NewRow ctx={ctx} depth={0} />}
          <Rows nodes={rest} depth={0} ctx={ctx} />
        </div>
      </section>
    </div>
  )
}
