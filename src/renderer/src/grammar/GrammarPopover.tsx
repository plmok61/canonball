import { useEffect, useState } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/core'
import {
  applyGrammarSuggestion,
  grammarLintAt,
  ignoreGrammarLint,
  type FoundLint
} from './grammarExtension'
import './grammar.css'

interface Open {
  found: FoundLint
  x: number
  y: number
}

/**
 * Shows a grammar lint's message and fixes. Nothing changes until the writer
 * clicks a fix or Ignore.
 */
export function GrammarPopover({ editor }: { editor: TipTapEditor }): React.JSX.Element | null {
  const [open, setOpen] = useState<Open | null>(null)

  useEffect(() => {
    const dom = editor.view.dom

    const show = (event: MouseEvent): boolean => {
      const target = event.target
      if (!(target instanceof Element)) return false
      const mark = target.closest('.cb-grammar')
      if (!mark || !dom.contains(mark)) return false
      let found: FoundLint | null
      try {
        found = grammarLintAt(editor.state, editor.view.posAtDOM(mark, 0))
      } catch {
        return false
      }
      if (!found) return false
      const rect = mark.getBoundingClientRect()
      setOpen({ found, x: rect.left, y: rect.bottom + 4 })
      return true
    }

    const onClick = (event: MouseEvent): void => {
      show(event)
    }
    const onContextMenu = (event: MouseEvent): void => {
      if (show(event)) event.preventDefault()
    }
    dom.addEventListener('click', onClick)
    dom.addEventListener('contextmenu', onContextMenu)
    return () => {
      dom.removeEventListener('click', onClick)
      dom.removeEventListener('contextmenu', onContextMenu)
    }
  }, [editor])

  const isOpen = open !== null
  useEffect(() => {
    if (!isOpen) return
    const close = (): void => setOpen(null)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    const onDown = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('.cb-grammar-popover')) return
      close()
    }
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }): void => {
      if (transaction.docChanged) close()
    }
    const scroller = editor.view.dom.closest('.cb-page-scroll')
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    scroller?.addEventListener('scroll', close)
    editor.on('transaction', onTransaction)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      scroller?.removeEventListener('scroll', close)
      editor.off('transaction', onTransaction)
    }
  }, [editor, isOpen])

  if (!open) return null
  const { found } = open

  // Re-check at click time: only act if this lint is still underlined there.
  const current = (): FoundLint | null => {
    const now = grammarLintAt(editor.state, found.from)
    return now && now.from === found.from && now.to === found.to ? now : null
  }

  return (
    <div
      role="dialog"
      aria-label="Grammar suggestion"
      className="cb-grammar-popover"
      style={{ left: open.x, top: open.y }}
    >
      <p>{found.lint.message}</p>
      <div className="cb-grammar-actions">
        {found.lint.suggestions.map((s, i) => (
          <button
            key={`${i}:${s.label}`}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const now = current()
              if (now) applyGrammarSuggestion(editor, now, s.replacement)
              setOpen(null)
            }}
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const now = current()
            if (now) ignoreGrammarLint(editor, now)
            setOpen(null)
          }}
        >
          Ignore
        </button>
      </div>
    </div>
  )
}
