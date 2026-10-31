import { CHAT_ID_RE } from './ai'

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'failed'

export interface Proposal {
  id: string
  kind: 'edit' | 'create'
  relPath: string
  before: string
  after: string
  status: ProposalStatus
  error?: string
}

export const EXPIRED_PROPOSAL = 'This suggestion is no longer available. Ask the AI again.'
export const CHANGED_SINCE_PROPOSAL =
  'This file changed after the AI suggested the edit. Ask again for a fresh suggestion.'

const STATUSES: readonly string[] = ['pending', 'accepted', 'rejected', 'failed']

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function parseProposal(x: unknown): Proposal | null {
  if (!isRecord(x)) return null
  if (typeof x.id !== 'string' || !CHAT_ID_RE.test(x.id)) return null
  if (x.kind !== 'edit' && x.kind !== 'create') return null
  if (typeof x.relPath !== 'string' || x.relPath === '') return null
  if (typeof x.before !== 'string' || typeof x.after !== 'string') return null
  if (typeof x.status !== 'string' || !STATUSES.includes(x.status)) return null
  const p: Proposal = {
    id: x.id,
    kind: x.kind,
    relPath: x.relPath,
    before: x.before,
    after: x.after,
    status: x.status as ProposalStatus
  }
  if (x.error !== undefined) {
    if (typeof x.error !== 'string') return null
    p.error = x.error
  }
  return p
}

export function displayPath(relPath: string): string {
  return relPath.replace(/\.md$/, '')
}

export function proposalNote(p: Proposal): string {
  const what = p.kind === 'edit' ? 'an edit to' : 'a new file'
  return `[Suggested ${what} ${p.relPath}: ${p.status}]`
}
