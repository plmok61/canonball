import { useEffect, useRef, useState } from 'react'
import {
  chatTitle,
  type AiStatus,
  type ChatEvent,
  type ChatMessage,
  type ChatSummary,
  type ChatThread,
  type ModelList
} from '../../../shared/ai'
import { ChatComposer } from './ChatComposer'
import { ChatHeader } from './ChatHeader'
import { hasConnection, message, parseChoice, type View } from './chatPanelState'
import { ChatLog } from './ChatLog'
import './chat.css'

interface Props {
  root: string
  /** Bumped when an AI connection changes; models are fetched again. */
  aiVersion: number
  onOpenSettings(): void
}

const NO_REPLY = 'No reply came back. Try again or pick another model.'
/** A Stop click this soon after Send is the second half of a double-click, not a request to stop. */
const STOP_GRACE_MS = 300

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

  const threadValue = view.saved && view.thread ? view.thread.id : ''

  return (
    <div className="cb-chat">
      <ChatHeader
        status={status}
        models={models}
        summaries={summaries}
        threadValue={threadValue}
        busy={busy}
        onChooseModel={chooseModel}
        onChooseThread={chooseThread}
        onOpenSettings={onOpenSettings}
      />
      <ChatLog
        messages={messages}
        busy={busy}
        connected={connected}
        onOpenSettings={onOpenSettings}
      />
      {error && (
        <p role="alert" className="cb-chat-error">
          {error}
        </p>
      )}
      <ChatComposer
        input={input}
        busy={busy}
        canSend={canSend}
        onInput={setInput}
        onSend={send}
        onStop={stop}
      />
    </div>
  )
}
