import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ChatThread } from '../../../shared/ai'
import type { Proposal, ProposalStatus } from '../../../shared/proposals'
import { flushAll } from '../editor/saveRegistry'
import { message, type View } from './chatPanelState'

interface Options {
  root: string
  /** Always the latest view; read at the moment of each update so streamed text is never lost. */
  viewRef: RefObject<View>
  /** Shows and saves a changed thread. */
  update(thread: ChatThread): void
  alive: RefObject<boolean>
  onFileChanged(relPath: string): void
}

export interface Proposals {
  /** Ids of cards whose Accept is in flight. */
  busy: ReadonlySet<string>
  accept(p: Proposal): void
  reject(p: Proposal): void
}

function withStatus(p: Proposal, status: ProposalStatus, error?: string): Proposal {
  const next: Proposal = {
    id: p.id,
    kind: p.kind,
    relPath: p.relPath,
    before: p.before,
    after: p.after,
    status
  }
  if (error !== undefined) next.error = error
  return next
}

/** Accept/Reject for proposal cards. Every status change is a new messages array, and is saved. */
export function useProposals({ root, viewRef, update, alive, onFileChanged }: Options): Proposals {
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const busyRef = useRef(new Set<string>())
  const latest = useRef({ update, onFileChanged })
  useEffect(() => {
    latest.current = { update, onFileChanged }
  })

  const setStatus = (id: string, status: ProposalStatus, error?: string): void => {
    if (!alive.current) return
    const { thread } = viewRef.current
    if (!thread) return
    let found = false
    const messages = thread.messages.map((m) => {
      if (!m.proposals?.some((p) => p.id === id)) return m
      found = true
      return {
        ...m,
        proposals: m.proposals.map((p) => (p.id === id ? withStatus(p, status, error) : p))
      }
    })
    // The writer switched threads meanwhile; that thread isn't on screen to update.
    if (!found) return
    latest.current.update({ ...thread, updatedAt: new Date().toISOString(), messages })
  }

  const markBusy = (id: string, on: boolean): void => {
    if (on) busyRef.current.add(id)
    else busyRef.current.delete(id)
    if (alive.current) setBusy(new Set(busyRef.current))
  }

  const accept = (p: Proposal): void => {
    if (busyRef.current.has(p.id)) return
    markBusy(p.id, true)
    void (async () => {
      try {
        try {
          await flushAll()
        } catch (e) {
          setStatus(p.id, 'failed', `Couldn't save your own changes first: ${message(e)}`)
          return
        }
        try {
          const { relPath } = await window.canonball.applyProposal(root, p.id)
          setStatus(p.id, 'accepted')
          if (alive.current) latest.current.onFileChanged(relPath)
        } catch (e) {
          setStatus(p.id, 'failed', message(e))
        }
      } finally {
        markBusy(p.id, false)
      }
    })()
  }

  const reject = (p: Proposal): void => {
    if (busyRef.current.has(p.id)) return
    setStatus(p.id, 'rejected')
    window.canonball.rejectProposal(p.id).catch(() => {
      // nothing was written; main forgets it either way
    })
  }

  return { busy, accept, reject }
}
