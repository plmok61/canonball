import { useEffect, useId, useRef, useState } from 'react'
import { SESSION_GOAL_MAX } from '../../../shared/ai'

interface Props {
  canStart: boolean
  onStart(goal: string): void
  onCancel(): void
}

/** Takes the place of the composer while the writer names a brainstorm goal. */
export function SessionStart({ canStart, onStart, onCancel }: Props): React.JSX.Element {
  const [goal, setGoal] = useState('')
  const id = useId()
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [])

  const trimmed = goal.trim()
  const ready = canStart && trimmed !== ''
  const submit = (): void => {
    if (ready) onStart(trimmed)
  }

  return (
    <form
      className="cb-session-start"
      aria-label="Start a brainstorm session"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <label htmlFor={id}>What do you want to figure out?</label>
      <textarea
        id={id}
        ref={box}
        rows={3}
        value={goal}
        maxLength={SESSION_GOAL_MAX}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="cb-session-start-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!ready}>
          Start session
        </button>
      </div>
    </form>
  )
}
