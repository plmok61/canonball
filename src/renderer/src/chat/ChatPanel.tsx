import { useEffect, useRef, useState } from 'react'
import {
  CLOUD_PROVIDERS,
  PROVIDER_LABEL,
  chatTitle,
  isProviderId,
  type AiStatus,
  type ChatEvent,
  type ChatMessage,
  type ChatSummary,
  type ChatThread,
  type ModelChoice,
  type ModelList,
  type ProviderId
} from '../../../shared/ai'
import { renderChatMarkdown } from './chatMarkdown'
import './chat.css'

interface Props {
  root: string
  /** Bumped when an AI connection changes; models are fetched again. */
  aiVersion: number
  onOpenSettings(): void
}

const PROVIDER_ORDER: ProviderId[] = [...CLOUD_PROVIDERS, 'local']
const NO_CONNECTION = 'Add an AI connection in Settings to start chatting.'
const NO_REPLY = 'No reply came back. Try again or pick another model.'
/** A Stop click this soon after Send is the second half of a double-click, not a request to stop. */
const STOP_GRACE_MS = 300

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const choiceValue = (c: ModelChoice): string => `${c.provider}:${c.model}`

function parseChoice(value: string): ModelChoice | null {
  const i = value.indexOf(':')
  if (i < 0) return null
  const provider = value.slice(0, i)
  const model = value.slice(i + 1)
  return isProviderId(provider) && model !== '' ? { provider, model } : null
}

function hasConnection(s: AiStatus): boolean {
  return s.localUrl !== null || CLOUD_PROVIDERS.some((p) => s.keys[p])
}

/** A brand-new thread lives only in memory until its first message is saved. */
interface View {
  thread: ChatThread | null
  saved: boolean
}

export function ChatPanel({ root, aiVersion, onOpenSettings }: Props): React.JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [models, setModels] = useState<ModelList | null>(null)
  const [summaries, setSummaries] = useState<ChatSummary[]>([])
  const [view, setView] = useState<View>({ thread: null, saved: false })
  const [loading, setLoading] = useState(true)
  const [streaming, setStreaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')

  const alive = useRef(true)
  const viewRef = useRef(view)
  const activeRef = useRef<string | null>(null)
  const saveChain = useRef<Promise<void>>(Promise.resolve())
  const loadToken = useRef(0)
  const logRef = useRef<HTMLDivElement>(null)
  const sentAt = useRef(0)

  const commit = (next: View): void => {
    viewRef.current = next
    setView(next)
  }

  const addError = (text: string): void => {
    if (alive.current) setError((prev) => (prev && prev !== text ? `${prev} ${text}` : text))
  }

  /** Saves run one after another so an older copy never lands last. */
  const save = (thread: ChatThread): void => {
    saveChain.current = saveChain.current.then(async () => {
      try {
        await window.canonball.saveChat(root, thread)
        if (!alive.current) return
        if (viewRef.current.thread?.id === thread.id && !viewRef.current.saved) {
          commit({ ...viewRef.current, saved: true })
        }
        const summary = { id: thread.id, title: thread.title, updatedAt: thread.updatedAt }
        setSummaries((list) => [summary, ...list.filter((s) => s.id !== thread.id)])
      } catch (e) {
        addError(`Couldn't save this chat: ${message(e)}`)
      }
    })
  }

  const finish = (requestId: string, failure: string | null, stopped = false): void => {
    if (activeRef.current !== requestId) return
    activeRef.current = null
    setStreaming(null)
    const { thread } = viewRef.current
    if (!thread) return
    const msgs = thread.messages
    const last = msgs[msgs.length - 1]
    const empty = !!last && last.role === 'assistant' && last.content === ''
    const kept = empty ? msgs.slice(0, -1) : msgs
    const done: ChatThread = { ...thread, updatedAt: new Date().toISOString(), messages: kept }
    commit({ ...viewRef.current, thread: done })
    if (failure !== null) addError(failure)
    else if (empty && !stopped) addError(NO_REPLY)
    save(done)
  }

  const onEvent = (e: ChatEvent): void => {
    if (e.requestId !== activeRef.current) return
    if (e.kind === 'delta') {
      const { thread } = viewRef.current
      if (!thread) return
      const msgs = thread.messages.slice()
      const last = msgs[msgs.length - 1]
      if (!last || last.role !== 'assistant') return
      msgs[msgs.length - 1] = { ...last, content: last.content + e.text }
      commit({ ...viewRef.current, thread: { ...thread, messages: msgs } })
    } else if (e.kind === 'done') {
      finish(e.requestId, null, e.stopped)
    } else if (e.kind === 'proposal') {
      // Proposal cards are wired up in a later task.
    } else {
      finish(e.requestId, e.message)
    }
  }
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  // Event subscription, cleanup on unmount.
  useEffect(() => {
    alive.current = true
    const off = window.canonball.onChatEvent((e) => onEventRef.current(e))
    return () => {
      alive.current = false
      off()
      const id = activeRef.current
      activeRef.current = null
      if (id) void window.canonball.cancelChat(id).catch(() => {})
    }
  }, [])

  // Thread list and the newest thread.
  useEffect(() => {
    // Mount only; the panel is keyed by project root. Picking a thread while
    // this runs bumps the token, so the writer's pick wins.
    const token = ++loadToken.current
    let cancelled = false
    const current = (): boolean => !cancelled && token === loadToken.current
    ;(async () => {
      try {
        const list = await window.canonball.listChats()
        if (cancelled) return
        setSummaries(list)
        if (!current()) return
        if (list.length > 0) {
          const t = await window.canonball.loadChat(list[0].id)
          if (current()) commit({ thread: t, saved: true })
        }
      } catch (e) {
        if (current()) addError(message(e))
      } finally {
        if (current()) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Connections and models, again whenever a connection changes.
  useEffect(() => {
    let cancelled = false
    window.canonball
      .getAiStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch((e) => {
        if (!cancelled) addError(message(e))
      })
    window.canonball
      .listModels()
      .then((list) => {
        if (!cancelled) setModels(list)
      })
      .catch((e) => {
        if (!cancelled) addError(message(e))
      })
    return () => {
      cancelled = true
    }
  }, [aiVersion])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [view.thread])

  const messages = view.thread?.messages ?? []

  const chosen = status?.model ?? null
  const busy = streaming !== null

  const chooseModel = (value: string): void => {
    const choice = parseChoice(value)
    if (!choice) return
    setError(null)
    window.canonball
      .setModel(choice)
      .then((s) => {
        if (alive.current) setStatus(s)
      })
      .catch((e) => addError(message(e)))
  }

  const chooseThread = (id: string): void => {
    if (activeRef.current) return
    setError(null)
    const token = ++loadToken.current
    if (id === '') {
      setLoading(false)
      commit({ thread: null, saved: false })
      return
    }
    setLoading(true)
    window.canonball
      .loadChat(id)
      .then((t) => {
        if (token === loadToken.current && alive.current) commit({ thread: t, saved: true })
      })
      .catch((e) => {
        if (token === loadToken.current) addError(message(e))
      })
      .finally(() => {
        if (token === loadToken.current && alive.current) setLoading(false)
      })
  }

  const canSend = !busy && !loading && chosen !== null && input.trim() !== ''

  const send = (): void => {
    if (!canSend || !chosen || activeRef.current) return
    const text = input
    const now = new Date().toISOString()
    const base: ChatThread = viewRef.current.thread ?? {
      version: 1,
      id: crypto.randomUUID(),
      title: chatTitle(text),
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    const userMsg: ChatMessage = { role: 'user', content: text, at: now }
    const withUser: ChatThread = { ...base, updatedAt: now, messages: [...base.messages, userMsg] }
    // Turns are taken before the empty reply is added: the last turn must be the writer's.
    const turns = withUser.messages.map(({ role, content }) => ({ role, content }))
    const reply: ChatMessage = { role: 'assistant', content: '', at: now, model: chosen }
    const requestId = crypto.randomUUID()

    setError(null)
    setInput('')
    commit({
      ...viewRef.current,
      thread: { ...withUser, messages: [...withUser.messages, reply] }
    })
    activeRef.current = requestId
    sentAt.current = Date.now()
    setStreaming(requestId)
    save(withUser)
    window.canonball
      .startChat({ requestId, model: chosen, messages: turns })
      .catch((e) => finish(requestId, message(e)))
  }

  const stop = (): void => {
    const id = activeRef.current
    if (!id || Date.now() - sentAt.current < STOP_GRACE_MS) return
    window.canonball.cancelChat(id).catch((e) => finish(id, message(e)))
  }

  const connected = status ? hasConnection(status) : true
  const listed = models?.models ?? []
  const chosenListed = chosen
    ? listed.some((m) => m.provider === chosen.provider && m.model === chosen.model)
    : false
  const groups = PROVIDER_ORDER.map((p) => {
    const options = listed
      .filter((m) => m.provider === p)
      .map((m) => ({ value: choiceValue(m), label: m.label }))
    if (chosen && !chosenListed && chosen.provider === p) {
      options.push({ value: choiceValue(chosen), label: chosen.model })
    }
    return { provider: p, options }
  }).filter((g) => g.options.length > 0)

  const threadValue = view.saved && view.thread ? view.thread.id : ''

  return (
    <div className="cb-chat">
      <header className="cb-chat-header">
        <div className="cb-chat-pickers">
          <select
            aria-label="Model"
            value={chosen ? choiceValue(chosen) : ''}
            disabled={status === null}
            onChange={(e) => chooseModel(e.target.value)}
          >
            {!chosen && (
              <option value="" disabled>
                Choose a model
              </option>
            )}
            {groups.map((g) => (
              <optgroup key={g.provider} label={PROVIDER_LABEL[g.provider]}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            aria-label="Chat"
            value={threadValue}
            disabled={busy}
            onChange={(e) => chooseThread(e.target.value)}
          >
            {summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            <option value="">New chat</option>
          </select>
        </div>
        <button
          type="button"
          className="cb-chat-gear"
          aria-label="AI settings"
          title="AI settings"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </header>
      {models && models.errors.length > 0 && (
        <ul className="cb-chat-model-errors">
          {models.errors.map((e) => (
            <li key={e.provider}>
              {PROVIDER_LABEL[e.provider]}: {e.message}
            </li>
          ))}
        </ul>
      )}
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
            </div>
          )
        )}
      </div>
      {error && (
        <p role="alert" className="cb-chat-error">
          {error}
        </p>
      )}
      <div className="cb-chat-composer">
        <textarea
          aria-label="Message"
          rows={3}
          value={input}
          // Read-only, not disabled, while a reply streams, so the writer keeps focus.
          readOnly={busy}
          aria-busy={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button key="stop" type="button" onClick={stop}>
            Stop
          </button>
        ) : (
          <button key="send" type="button" disabled={!canSend} onClick={send}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}
