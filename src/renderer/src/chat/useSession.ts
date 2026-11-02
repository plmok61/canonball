import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  END_SESSION_MESSAGE,
  sessionTitle,
  type ChatThread,
  type SessionRequest
} from '../../../shared/ai'
import { newThread, type View } from './chatPanelState'

export interface SendOptions {
  /** A thread to send into instead of the open one (a brand-new session). */
  thread?: ChatThread
  session?: SessionRequest
  /** Runs only when the reply finishes with no error and wasn't stopped. */
  onDone?(): void
}

export type SendMessage = (text: string, opts?: SendOptions) => void

interface Options {
  /** Always the latest view. */
  viewRef: RefObject<View>
  sendMessage: SendMessage
  /** Shows and saves a changed thread. */
  update(thread: ChatThread): void
}

export interface Session {
  /** The start form is open in place of the composer. */
  starting: boolean
  openStart(): void
  closeStart(): void
  start(goal: string): void
  end(): void
}

/** What a normal message in this thread tells main: the brainstorm phase while the session is open, nothing otherwise. */
export function brainstormRequest(thread: ChatThread | null): SessionRequest | undefined {
  const s = thread?.session
  return s && s.endedAt === undefined ? { goal: s.goal, phase: 'brainstorm' } : undefined
}

export function useSession({ viewRef, sendMessage, update }: Options): Session {
  const [starting, setStarting] = useState(false)
  const latest = useRef({ sendMessage, update })
  useEffect(() => {
    latest.current = { sendMessage, update }
  })

  const start = (raw: string): void => {
    const goal = raw.trim()
    if (goal === '') return
    const thread = { ...newThread(sessionTitle(goal), new Date().toISOString()), session: { goal } }
    setStarting(false)
    latest.current.sendMessage(goal, { thread, session: { goal, phase: 'brainstorm' } })
  }

  const end = (): void => {
    const thread = viewRef.current.thread
    const session = thread?.session
    if (!thread || !session || session.endedAt !== undefined) return
    const id = thread.id
    latest.current.sendMessage(END_SESSION_MESSAGE, {
      session: { goal: session.goal, phase: 'end' },
      onDone: () => {
        const t = viewRef.current.thread
        // The writer can't switch threads mid-reply, but check rather than end the wrong one.
        if (!t || t.id !== id || !t.session || t.session.endedAt !== undefined) return
        const now = new Date().toISOString()
        latest.current.update({ ...t, updatedAt: now, session: { ...t.session, endedAt: now } })
      }
    })
  }

  return {
    starting,
    openStart: () => setStarting(true),
    closeStart: () => setStarting(false),
    start,
    end
  }
}
