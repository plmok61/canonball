import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../../shared/ai'
import { renderChatMarkdown } from './chatMarkdown'

interface Props {
  messages: ChatMessage[]
  busy: boolean
  connected: boolean
  onOpenSettings(): void
  /** Rendered after an assistant message's content. */
  renderProposals?(messageIndex: number): React.ReactNode
}

const NO_CONNECTION = 'Add an AI connection in Settings to start chatting.'

export function ChatLog({
  messages,
  busy,
  connected,
  onOpenSettings,
  renderProposals
}: Props): React.JSX.Element {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  return (
    <div className="cb-chat-log" role="log" ref={logRef}>
      {!connected && (
        <div className="cb-chat-empty">
          <p>{NO_CONNECTION}</p>
          <button type="button" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
      {messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="cb-chat-msg cb-chat-user">
            {m.content}
          </div>
        ) : (
          <div key={i} className="cb-chat-msg cb-chat-reply">
            {m.content === '' && busy && i === messages.length - 1 ? (
              <span className="cb-chat-waiting">…</span>
            ) : (
              renderChatMarkdown(m.content)
            )}
            {renderProposals?.(i)}
          </div>
        )
      )}
    </div>
  )
}
