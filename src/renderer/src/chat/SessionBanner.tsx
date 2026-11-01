import type { ChatSession } from '../../../shared/ai'

interface Props {
  session: ChatSession
  busy: boolean
  onEnd(): void
}

export function SessionBanner({ session, busy, onEnd }: Props): React.JSX.Element {
  const ended = session.endedAt !== undefined
  return (
    <div role="status" className="cb-session-banner">
      <span className="cb-session-goal">
        Brainstorm: {session.goal}
        {ended && <span className="cb-session-ended"> · Ended</span>}
      </span>
      {!ended && (
        <button type="button" disabled={busy} onClick={onEnd}>
          End session
        </button>
      )}
    </div>
  )
}
