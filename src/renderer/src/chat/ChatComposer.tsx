interface Props {
  input: string
  busy: boolean
  canSend: boolean
  onInput(value: string): void
  onSend(): void
  onStop(): void
}

export function ChatComposer({
  input,
  busy,
  canSend,
  onInput,
  onSend,
  onStop
}: Props): React.JSX.Element {
  return (
    <div className="cb-chat-composer">
      <textarea
        aria-label="Message"
        rows={3}
        value={input}
        // Read-only, not disabled, while a reply streams, so the writer keeps focus.
        readOnly={busy}
        aria-busy={busy}
        onChange={(e) => onInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      {busy ? (
        <button key="stop" type="button" onClick={onStop}>
          Stop
        </button>
      ) : (
        <button key="send" type="button" disabled={!canSend} onClick={onSend}>
          Send
        </button>
      )}
    </div>
  )
}
