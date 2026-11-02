import { useEffect, useRef, useState } from 'react'
import type {
  FileOpResult,
  Move,
  ProjectInfo,
  ProjectProtection,
  TreeMenuKind,
  TreeNode
} from '../../../shared/types'
import { isAtOrUnder, remapPath, topmost } from '../../../shared/fileNames'
import { cleanIpcMessage } from '../../../shared/ipcError'
import { isProtected } from '../../../shared/protection'
import {
  menuFor,
  type MenuTarget as MenuShape,
  type TreeMenuItem
} from '../../../shared/treeMenuItems'
import { flushAll } from '../editor/saveRegistry'
import type { EditingState, MenuTarget } from './FileTree'
import type { DragHandlers } from './dragDrop'
import { dropTarget } from './dragDrop'
import { createHistory, type History, type HistoryResult, type Step } from './history'
import { arrowSelect, visibleOrder, type Selection } from './selection'
import { splitTree } from './splitTree'

export interface Clipboard {
  mode: 'copy' | 'cut'
  paths: string[]
}

interface Options {
  project: ProjectInfo | null
  /** The sorted tree, as the FileTree shows it. */
  tree: TreeNode[]
  protection: ProjectProtection | undefined
  selection: Selection
  setSelection: React.Dispatch<React.SetStateAction<Selection>>
  selectedPath: string | null
  setSelectedPath: React.Dispatch<React.SetStateAction<string | null>>
  setTree(tree: TreeNode[]): void
  setProtection(protection: ProjectProtection): void
  setError(error: string | null): void
  /** App's one-action-at-a-time guard, shared with its other main calls. */
  savingRef: React.RefObject<boolean>
}

export interface FileActions {
  onMenu(target: MenuTarget): void
  onKey(e: React.KeyboardEvent): void
  editing: EditingState
  onEditSubmit(name: string): Promise<string | null>
  onEditCancel(): void
  cutPaths: string[]
  onFocusChange(focused: boolean): void
  treeFocused: boolean
  undo(): Promise<void>
  redo(): Promise<void>
  /** Moves from the latest action, for the FileTree's expanded folders. */
  moves: Move[]
  /** Folders the latest action wants shown open. */
  expand: string[]
  drag: DragHandlers
}

const NO_PATHS: string[] = []
const NO_MOVES: Move[] = []
const TRASH_DETAIL = 'This includes everything in it.'

function message(e: unknown): string {
  return cleanIpcMessage(e instanceof Error ? e.message : String(e))
}

function findNode(nodes: TreeNode[], relPath: string): TreeNode | null {
  for (const n of nodes) {
    if (n.relPath === relPath) return n
    if (n.children && isAtOrUnder(relPath, n.relPath)) {
      const found = findNode(n.children, relPath)
      if (found) return found
    }
  }
  return null
}

const parentOf = (relPath: string): string =>
  relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''

/** The name a writer sees: the last segment, without `.md` for a file. */
function shownName(tree: TreeNode[], relPath: string): string {
  const name = relPath.slice(relPath.lastIndexOf('/') + 1)
  return findNode(tree, relPath)?.kind === 'folder' ? name : name.replace(/\.md$/i, '')
}

/** `a/b/c` gives `a`, `a/b`, `a/b/c`; `''` gives none. */
function withAncestors(relPath: string): string[] {
  if (relPath === '') return []
  const parts = relPath.split('/')
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

const reversed = (moves: Move[]): Move[] => moves.map((m) => ({ from: m.to, to: m.from })).reverse()

export function useFileActions({
  project,
  tree,
  protection,
  selection,
  setSelection,
  selectedPath,
  setSelectedPath,
  setTree,
  setProtection,
  setError,
  savingRef
}: Options): FileActions {
  const api = window.canonball
  // The clipboard and the history belong to one opened project; a switch (even to the
  // same folder) gives a new ProjectInfo, so both start empty.
  const [clipState, setClipState] = useState<{ project: ProjectInfo; clip: Clipboard } | null>(null)
  const clip = clipState && clipState.project === project ? clipState.clip : null
  const historyRef = useRef<{ project: ProjectInfo; history: History } | null>(null)
  const [editing, setEditing] = useState<EditingState>(null)
  const [treeFocused, setTreeFocused] = useState(false)
  const [moves, setMoves] = useState<Move[]>(NO_MOVES)
  const [expand, setExpand] = useState<string[]>(NO_PATHS)
  const rootRef = useRef<string | null>(null)
  useEffect(() => {
    rootRef.current = project?.root ?? null
  }, [project])

  /** Results only land if the project they came from is still open. */
  const live = (at: string): boolean => rootRef.current === at

  const historyFor = (p: ProjectInfo): History => {
    if (historyRef.current?.project !== p) {
      const at = p.root
      historyRef.current = {
        project: p,
        history: createHistory(at, api, (r: HistoryResult) => {
          if (!live(at)) return
          if (r.tree) setTree(r.tree)
          setProtection(r.protection)
        })
      }
    }
    return historyRef.current.history
  }

  const apply = (r: FileOpResult): void => {
    setTree(r.tree)
    setProtection(r.protection)
  }

  /** The open file and the selection follow renamed and moved items. */
  const follow = (ms: Move[]): void => {
    if (ms.length === 0) return
    const remap = (p: string): string => ms.reduce(remapPath, p)
    setSelectedPath((prev) => (prev === null ? null : remap(prev)))
    setSelection((prev) => ({
      paths: prev.paths.map(remap),
      anchor: prev.anchor === null ? null : remap(prev.anchor)
    }))
    setMoves(ms)
  }

  /** Items that left the tree: close the open file if it was one of them. */
  const drop = (gone: string[]): void => {
    const under = (p: string): boolean => gone.some((g) => isAtOrUnder(p, g))
    setSelectedPath((prev) => (prev !== null && under(prev) ? null : prev))
    setSelection((prev) => ({
      paths: prev.paths.filter((p) => !under(p)),
      anchor: prev.anchor !== null && under(prev.anchor) ? null : prev.anchor
    }))
  }

  const select = (paths: string[]): void => {
    if (paths.length) setSelection({ paths, anchor: paths[paths.length - 1] })
  }

  const touchesOpen = (paths: string[]): boolean =>
    selectedPath !== null && paths.some((p) => isAtOrUnder(selectedPath, p))

  /**
   * After a failed action, catch up with disk: main keeps the moves a multi-item
   * action finished before it failed. If the open file is no longer in the tree
   * it is closed. No flush is needed here: an action that can move the open file
   * touches it, so `run` flushed it before the action began.
   */
  const resync = async (at: string): Promise<void> => {
    const [fresh, prot] = await Promise.allSettled([api.refreshTree(), api.getProjectProtection()])
    if (!live(at)) return
    if (prot.status === 'fulfilled') setProtection(prot.value)
    if (fresh.status !== 'fulfilled') return
    setTree(fresh.value)
    const present = (p: string): boolean => findNode(fresh.value, p) !== null
    setSelectedPath((prev) => (prev !== null && !present(prev) ? null : prev))
    setSelection((prev) => ({
      paths: prev.paths.filter(present),
      anchor: prev.anchor !== null && !present(prev.anchor) ? null : prev.anchor
    }))
  }

  /**
   * One main-process action at a time. The open file's pending save is flushed first
   * when the action touches it; if that fails nothing is changed.
   */
  const run = async (touched: string[], fn: (at: string) => Promise<void>): Promise<void> => {
    if (!project || savingRef.current) return
    const at = project.root
    savingRef.current = true
    setError(null)
    try {
      if (touchesOpen(touched)) {
        try {
          await flushAll()
        } catch (e) {
          setError(`Couldn't save your changes, so nothing was changed: ${message(e)}`)
          return
        }
      }
      await fn(at)
    } catch (e) {
      if (!live(at)) return
      setError(message(e))
      await resync(at)
    } finally {
      savingRef.current = false
    }
  }

  const push = (step: Step): void => {
    if (project) historyFor(project).push(step)
  }

  /** Paste goes into a folder, a file's folder, or the top level. */
  const destFor = (targets: string[]): string => {
    if (targets.length === 0) return ''
    const t = targets[targets.length - 1]
    return findNode(tree, t)?.kind === 'folder' ? t : parentOf(t)
  }

  const setClip = (mode: Clipboard['mode'], targets: string[]): void => {
    if (!project || targets.length === 0) return
    setClipState({ project, clip: { mode, paths: topmost(targets) } })
  }

  /**
   * Copies or moves `paths` into `dest`: shared by paste and drop. Only a paste
   * from the clipboard empties it.
   */
  const transfer = (
    mode: 'copy' | 'cut',
    paths: string[],
    dest: string,
    label: string,
    fromClip: boolean
  ): Promise<void> =>
    run(paths, async (at) => {
      const r = await api.pasteEntries(at, mode === 'cut' ? 'move' : 'copy', paths, dest)
      if (!live(at)) return
      apply(r)
      if (mode === 'cut') {
        // A cut pasted back into its own folder moves nothing and stays on the clipboard.
        if (r.moves.length === 0) return
        // Cut items leave the clipboard after one paste.
        if (fromClip) setClipState(null)
        push({ kind: 'move', label, moves: r.moves, folded: r.folded })
        follow(r.moves)
      } else if (r.created.length) {
        push({ kind: 'create', label, created: r.created })
        select(r.created)
      }
    })

  const paste = (dest: string): Promise<void> => {
    const c = clip
    if (!c || c.paths.length === 0) return Promise.resolve()
    return transfer(c.mode, c.paths, dest, 'Paste', true)
  }

  // Drag and drop: the items being dragged, set on drag start.
  const dragging = useRef<string[] | null>(null)
  const drag: DragHandlers = {
    onDragStart: (relPath) => {
      dragging.current = null
      if (!project || editing || savingRef.current) return
      if (selection.paths.includes(relPath)) dragging.current = topmost(selection.paths)
      else {
        dragging.current = [relPath]
        setSelection({ paths: [relPath], anchor: relPath })
      }
    },
    onDragOver: (target, copy) =>
      dragging.current !== null && dropTarget(dragging.current, target, copy) !== null,
    onDrop: (target, copy) => {
      const items = dragging.current
      dragging.current = null
      if (!items || savingRef.current) return
      const dest = dropTarget(items, target, copy)
      if (dest === null) return
      void transfer(copy ? 'copy' : 'cut', items, dest, copy ? 'Copy' : 'Move', false)
    },
    onDragEnd: () => {
      dragging.current = null
    }
  }

  const duplicate = (targets: string[]): Promise<void> => {
    const top = topmost(targets)
    if (top.length === 0) return Promise.resolve()
    return run(top, async (at) => {
      const r = await api.duplicateEntries(at, top)
      if (!live(at)) return
      apply(r)
      if (r.created.length) {
        push({ kind: 'create', label: 'Duplicate', created: r.created })
        select(r.created)
      }
    })
  }

  const trash = (targets: string[]): Promise<void> => {
    const top = topmost(targets)
    if (top.length === 0) return Promise.resolve()
    return run(top, async (at) => {
      const msg =
        top.length === 1
          ? `Move "${shownName(tree, top[0])}" to the Trash?`
          : `Move ${top.length} items to the Trash?`
      const anyFolder = top.some((p) => findNode(tree, p)?.kind === 'folder')
      const ok = await api.confirmDialog(
        anyFolder
          ? { message: msg, detail: TRASH_DETAIL, ok: 'Move to Trash' }
          : { message: msg, ok: 'Move to Trash' }
      )
      if (!ok) return
      const r = await api.trashEntries(at, top)
      if (!live(at)) return
      apply(r)
      push({ kind: 'trash', label: 'Move to Trash', items: r.trashed })
      drop(top)
    })
  }

  const protect = (kind: TreeMenuKind, targets: string[]): Promise<void> =>
    run([], async (at) => {
      const r = await api.changeProtectionMany(at, kind, topmost(targets))
      if (!live(at)) return
      setProtection(r.protection)
      if (r.delta.added.length || r.delta.removed.length) {
        push({
          kind: 'protect',
          label: kind === 'protect' ? 'Protect' : 'Stop Protecting',
          delta: r.delta
        })
      }
    })

  const reveal = (relPath: string): void => {
    if (!project) return
    // Not undoable, and harmless during another action, so not guarded.
    api.revealEntry(project.root, relPath).catch((e) => setError(message(e)))
  }

  /** True when any of the files has text, so undoing its creation needs a confirm. */
  const firstWithText = async (paths: string[]): Promise<string | null> => {
    for (const p of paths) {
      try {
        const doc = await api.readDoc(p)
        if (doc.content.trim() !== '') return p
      } catch {
        // gone or unreadable: undo itself reports it
      }
    }
    return null
  }

  const undo = async (): Promise<void> => {
    if (!project) return
    const history = historyFor(project)
    const step = history.peekUndo()
    if (!step) return
    // Undo can move or remove the open file, so its typing is saved first.
    await run(selectedPath ? [selectedPath] : [], async (at) => {
      if (step.kind === 'create' && step.label === 'New File') {
        const withText = await firstWithText(step.created)
        if (withText) {
          const ok = await api.confirmDialog({
            message: `Undo New File? "${shownName(tree, withText)}" has text in it. It will go to the Trash.`,
            ok: 'Undo'
          })
          if (!ok) return
        }
      }
      const done = await history.undo()
      if (!done || !live(at)) return
      if (done.kind === 'move') follow(reversed(done.moves))
      else if (done.kind === 'create') drop(done.created)
    })
  }

  const redo = async (): Promise<void> => {
    if (!project) return
    const history = historyFor(project)
    if (!history.canRedo()) return
    await run(selectedPath ? [selectedPath] : [], async (at) => {
      const done = await history.redo()
      if (!done || !live(at)) return
      if (done.kind === 'move') follow(done.moves)
      else if (done.kind === 'trash') drop(done.items.map((i) => i.from))
    })
  }

  const doItem = (item: TreeMenuItem, targets: string[]): void => {
    switch (item) {
      case 'new-file':
      case 'new-folder':
        setEditing({
          mode: 'new',
          kind: item === 'new-file' ? 'file' : 'folder',
          parentRel: targets[0] ?? ''
        })
        break
      case 'rename':
        if (targets.length === 1) setEditing({ mode: 'rename', relPath: targets[0] })
        break
      case 'duplicate':
        void duplicate(targets)
        break
      case 'cut':
      case 'copy':
        setClip(item, targets)
        break
      case 'paste':
        void paste(destFor(targets))
        break
      case 'reveal':
        if (targets.length === 1) reveal(targets[0])
        break
      case 'trash':
        void trash(targets)
        break
      case 'protect':
      case 'unprotect':
        void protect(item, targets)
        break
    }
  }

  const menuShape = (targets: string[]): MenuShape => {
    const settings = protection!.settings
    const kind: MenuShape['kind'] =
      targets.length === 0
        ? 'empty'
        : targets.length > 1
          ? 'multi'
          : (findNode(tree, targets[0])?.kind ?? 'file')
    // Rows inside a protected folder get neither Protect nor Stop protecting. A folder
    // selected with its own contents stands for them.
    const top = topmost(targets)
    const protectRule: MenuShape['protectRule'] =
      top.length === 0
        ? 'none'
        : top.every((t) => settings.protected.includes(t))
          ? 'unprotect'
          : top.every((t) => !isProtected(settings, t))
            ? 'protect'
            : 'none'
    return { kind, protectRule, canPaste: !!clip && clip.paths.length > 0 }
  }

  const onMenu = async ({ relPath }: MenuTarget): Promise<void> => {
    if (!project || !protection || protection.unreadable || savingRef.current) return
    let targets: string[]
    if (relPath === null) targets = []
    else if (selection.paths.includes(relPath)) targets = selection.paths
    else {
      targets = [relPath]
      setSelection({ paths: [relPath], anchor: relPath })
    }
    let chosen: TreeMenuItem | null
    try {
      chosen = await api.showTreeMenu(menuFor(menuShape(targets)))
    } catch (e) {
      setError(message(e))
      return
    }
    if (chosen) doItem(chosen, targets)
  }

  /** Rows top to bottom as the tree shows them now, folded folders included. */
  const shownOrder = (container: Element): string[] => {
    const open = new Set(
      Array.from(container.querySelectorAll('[role="treeitem"][aria-expanded="true"]')).map((el) =>
        el.getAttribute('data-path')
      )
    )
    const { protectedRoots, rest } = splitTree(tree, protection?.settings.protected ?? [])
    return visibleOrder(
      protectedRoots.map((r) => r.node),
      rest,
      (p) => open.has(p)
    )
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (!project || !treeFocused || editing) return
    if (e.target instanceof HTMLInputElement) return
    const mod = e.metaKey || e.ctrlKey
    if (!mod && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const order = shownOrder(e.currentTarget)
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setSelection((prev) => arrowSelect(prev, dir, e.shiftKey, order))
      return
    }
    // File actions wait, like the menu, until the settings file can be read.
    if (!protection || protection.unreadable) return
    const targets = selection.paths
    if (!mod) {
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        doItem('rename', targets)
      }
      return
    }
    switch (e.key.toLowerCase()) {
      case 'c':
        e.preventDefault()
        setClip('copy', targets)
        break
      case 'x':
        e.preventDefault()
        setClip('cut', targets)
        break
      case 'v':
        e.preventDefault()
        void paste(destFor(targets))
        break
      case 'd':
        e.preventDefault()
        void duplicate(targets)
        break
      case 'backspace':
        e.preventDefault()
        void trash(targets)
        break
    }
  }

  const onEditSubmit = async (name: string): Promise<string | null> => {
    const edit = editing
    if (!project || !edit || savingRef.current) return null
    const at = project.root
    savingRef.current = true
    setError(null)
    try {
      if (edit.mode === 'rename') {
        if (name === shownName(tree, edit.relPath)) {
          setEditing(null)
          return null
        }
        if (touchesOpen([edit.relPath])) {
          try {
            await flushAll()
          } catch (e) {
            return `Couldn't save your changes, so nothing was renamed: ${message(e)}`
          }
        }
        // For a file, the name has no `.md`; main keeps it.
        const r = await api.renameEntry(at, edit.relPath, name)
        if (!live(at)) return null
        apply(r)
        if (r.move.from !== r.move.to) {
          push({ kind: 'move', label: 'Rename', moves: [r.move], folded: r.folded })
          follow([r.move])
        }
      } else {
        const r = await api.createEntry(at, edit.kind, edit.parentRel, name)
        if (!live(at)) return null
        apply(r)
        push({
          kind: 'create',
          label: edit.kind === 'file' ? 'New File' : 'New Folder',
          created: [r.relPath]
        })
        select([r.relPath])
        // The box forced its folder open; keep it open so the new row stays in view.
        const shown = withAncestors(edit.parentRel)
        if (edit.kind === 'file') setSelectedPath(r.relPath)
        else shown.push(r.relPath)
        if (shown.length) setExpand(shown)
      }
      setEditing(null)
      return null
    } catch (e) {
      return message(e)
    } finally {
      savingRef.current = false
    }
  }

  // The name box unmounts without a blur, so focus would drop to the page and the
  // tree's keys would stop working. Give it back to the tree unless it went elsewhere.
  const wasEditing = useRef(false)
  useEffect(() => {
    if (editing) {
      wasEditing.current = true
      return
    }
    if (!wasEditing.current) return
    wasEditing.current = false
    const active = document.activeElement
    if (!active || active === document.body) {
      document.querySelector<HTMLElement>('.cb-tree-scroll')?.focus()
    }
  }, [editing])

  return {
    onMenu: (t) => void onMenu(t),
    onKey,
    editing,
    onEditSubmit,
    onEditCancel: () => setEditing(null),
    cutPaths: clip?.mode === 'cut' ? clip.paths : NO_PATHS,
    onFocusChange: setTreeFocused,
    treeFocused,
    undo,
    redo,
    moves,
    expand,
    drag
  }
}
