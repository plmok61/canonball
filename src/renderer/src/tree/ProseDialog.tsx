import { useEffect, useRef, useState } from 'react'
import type { TreeNode } from '../../../shared/types'
import { displayName } from '../../../shared/paths'
import { sortTree } from './sortTree'

interface Props {
  tree: TreeNode[]
  initial: string[]
  onDone(prose: string[]): void
  /** When given, a Cancel button (and Escape) closes the dialog without saving. */
  onCancel?(): void
  /** Disables Done while a save is in flight. */
  busy?: boolean
  /** Why the last save failed, shown inside the dialog. */
  error?: string | null
}

interface Row {
  relPath: string
  label: string
  depth: number
}

function folderRows(nodes: TreeNode[], depth: number, out: Row[]): Row[] {
  for (const n of nodes) {
    if (n.kind !== 'folder') continue
    out.push({ relPath: n.relPath, label: n.name, depth })
    folderRows(n.children ?? [], depth + 1, out)
  }
  return out
}

export function ProseDialog({
  tree,
  initial,
  onDone,
  onCancel,
  busy,
  error
}: Props): React.JSX.Element {
  const sorted = sortTree(tree)
  const folders = folderRows(sorted, 0, [])
  const files: Row[] = sorted
    .filter((n) => n.kind === 'file')
    .map((n) => ({ relPath: n.relPath, label: displayName(n.name), depth: 0 }))
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(initial))
  const firstRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    ;(firstRef.current ?? doneRef.current)?.focus()
  }, [])

  const toggle = (relPath: string): void =>
    setTicked((cur) => {
      const next = new Set(cur)
      if (!next.delete(relPath)) next.add(relPath)
      return next
    })

  const all = [...folders, ...files]
  // Entries with no row (orphaned or hand-edited paths) stay protected.
  const rowPaths = new Set(all.map((r) => r.relPath))
  const done = (): void =>
    onDone([
      ...all.map((r) => r.relPath).filter((p) => ticked.has(p)),
      ...initial.filter((p) => !rowPaths.has(p))
    ])

  const item = (r: Row, first: boolean): React.JSX.Element => (
    <li key={r.relPath} style={{ paddingLeft: r.depth * 16 }}>
      <label>
        <input
          ref={first ? firstRef : undefined}
          type="checkbox"
          checked={ticked.has(r.relPath)}
          onChange={() => toggle(r.relPath)}
        />{' '}
        {r.label}
      </label>
    </li>
  )

  return (
    <div className="cb-dialog-overlay">
      <div
        className="cb-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cb-prose-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && onCancel) onCancel()
          if (e.key === 'Tab') {
            const els = e.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([disabled]), button:not([disabled])'
            )
            const first = els[0]
            const last = els[els.length - 1]
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first.focus()
            } else if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last.focus()
            }
          }
        }}
      >
        <h2 id="cb-prose-title">Which folders hold your prose?</h2>
        <p>The AI can read prose to answer questions, but it will never edit it.</p>
        <div className="cb-dialog-list">
          <ul>{folders.map((r, i) => item(r, i === 0))}</ul>
          {files.length > 0 && (
            <>
              <h3>Files at the top level</h3>
              <ul>{files.map((r, i) => item(r, folders.length === 0 && i === 0))}</ul>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="cb-dialog-error">
            {error}
          </p>
        )}
        <div className="cb-dialog-actions">
          {onCancel && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button ref={doneRef} type="button" disabled={busy} onClick={done}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
