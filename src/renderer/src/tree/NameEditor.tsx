import { useEffect, useRef, useState } from 'react'
import { nameError } from '../../../shared/fileNames'

interface Props {
  initial: string
  selectStem: boolean
  /** Resolves to an error message (the box stays open) or null (it closes). */
  onSubmit(name: string): Promise<string | null>
  onCancel(): void
}

export function NameEditor({ initial, selectStem, onSubmit, onCancel }: Props): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    const dot = initial.lastIndexOf('.')
    el.setSelectionRange(0, selectStem && dot > 0 ? dot : initial.length)
    // Select once, when the box opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (): Promise<void> => {
    if (busy.current) return
    const name = input.current?.value ?? ''
    const local = nameError(name)
    if (local) {
      setError(local)
      return
    }
    busy.current = true
    try {
      const err = await onSubmit(name)
      if (err) setError(err)
    } finally {
      busy.current = false
    }
  }

  return (
    <div className="cb-name-editor">
      <input
        ref={input}
        className="cb-name-input"
        aria-label="Name"
        aria-invalid={error !== null}
        defaultValue={initial}
        onChange={() => setError(null)}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => {
          if (!busy.current) onCancel()
        }}
        onKeyDown={(e) => {
          // Keep typing from reaching the tree's keyboard shortcuts.
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      {error && (
        <p role="alert" className="cb-name-error">
          {error}
        </p>
      )}
    </div>
  )
}
