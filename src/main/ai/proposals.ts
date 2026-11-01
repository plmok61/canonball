/**
 * In-memory proposals: validated against the access layer and the file on
 * disk when made, written only on Accept, and only if the file still holds
 * the text the proposal was built from. Proposing writes nothing.
 *
 * Stacked edits: if the file has moved on since an edit was proposed, Accept
 * re-applies the edit's own old_text/new_text pairs to the current text. That
 * only works when every old_text is still found exactly once, so it replaces
 * nothing but the edit's own text and never overwrites the writer's changes.
 * Otherwise Accept is refused and the proposal stays held.
 */
import { randomUUID } from 'crypto'
import { CHANGED_SINCE_PROPOSAL, EXPIRED_PROPOSAL } from '../../shared/proposals'
import type { Proposal } from '../../shared/proposals'
import { createAiAccess } from '../aiAccess'
import type { AiAccess } from '../aiAccess'

export interface EditSpec {
  old_text: string
  new_text: string
}

export class ProposalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProposalError'
  }
}

export interface ProposalStore {
  /** Validates against access and disk; returns the pending proposal or throws AccessDenied / ProposalError. Writes nothing. */
  proposeEdit(root: string, access: AiAccess, relPath: string, edits: EditSpec[]): Promise<Proposal>
  proposeCreate(root: string, access: AiAccess, relPath: string, content: string): Promise<Proposal>
  /** Writes through createAiAccess(root) after the content check; forgets the proposal. */
  apply(root: string, id: string): Promise<{ relPath: string }>
  reject(id: string): void
  clear(): void
}

/** Applies all edits to the original text together; each old_text must occur exactly once. */
export function applyEdits(text: string, edits: EditSpec[], relPath: string): string {
  const spans: { start: number; end: number; next: string }[] = []
  for (const e of edits) {
    const first = e.old_text === '' ? -1 : text.indexOf(e.old_text)
    if (first === -1) {
      throw new ProposalError(`old_text not found in ${relPath}: "${e.old_text.slice(0, 60)}"`)
    }
    let count = 0
    for (let i = first; i !== -1; i = text.indexOf(e.old_text, i + 1)) count++
    if (count > 1) {
      throw new ProposalError(
        `old_text appears ${count} times in ${relPath}; include more surrounding text`
      )
    }
    spans.push({ start: first, end: first + e.old_text.length, next: e.new_text })
  }
  spans.sort((a, b) => a.start - b.start)
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end) throw new ProposalError(`Edits overlap in ${relPath}`)
  }
  let out = ''
  let at = 0
  for (const s of spans) {
    out += text.slice(at, s.start) + s.next
    at = s.end
  }
  return out + text.slice(at)
}

/** Re-applies an edit's own pairs to moved-on text, or throws CHANGED_SINCE_PROPOSAL. */
function rebase(current: string, edits: EditSpec[] | undefined, relPath: string): string {
  if (!edits) throw new Error(CHANGED_SINCE_PROPOSAL)
  let result: string
  try {
    result = applyEdits(current, edits, relPath)
  } catch (err) {
    if (err instanceof ProposalError) throw new Error(CHANGED_SINCE_PROPOSAL, { cause: err })
    throw err
  }
  if (result === current) throw new Error(CHANGED_SINCE_PROPOSAL)
  return result
}

export function createProposalStore(deps?: { access?: (root: string) => AiAccess }): ProposalStore {
  const accessFor = deps?.access ?? createAiAccess
  const held = new Map<string, { root: string; proposal: Proposal; edits?: EditSpec[] }>()

  function hold(root: string, p: Omit<Proposal, 'id' | 'status'>, edits?: EditSpec[]): Proposal {
    const proposal: Proposal = { id: randomUUID(), status: 'pending', ...p }
    held.set(proposal.id, { root, proposal, edits })
    return { ...proposal }
  }

  return {
    async proposeEdit(root, access, relPath, edits) {
      const canonical = await access.checkWrite(relPath)
      const before = (await access.read(canonical)).content
      const after = applyEdits(before, edits, canonical)
      if (after === before) throw new ProposalError(`That edit doesn't change ${canonical}`)
      return hold(
        root,
        { kind: 'edit', relPath: canonical, before, after },
        edits.map((e) => ({ ...e }))
      )
    },

    async proposeCreate(root, access, relPath, content) {
      const canonical = await access.checkCreate(relPath)
      return hold(root, { kind: 'create', relPath: canonical, before: '', after: content })
    },

    async apply(root, id) {
      const entry = held.get(id)
      if (!entry || entry.root !== root) throw new Error(EXPIRED_PROPOSAL)
      const { proposal } = entry
      const access = accessFor(root)
      try {
        if (proposal.kind === 'edit') {
          const now = (await access.read(proposal.relPath)).content
          const next =
            now === proposal.before ? proposal.after : rebase(now, entry.edits, proposal.relPath)
          await access.write(proposal.relPath, next)
        } else {
          await access.create(proposal.relPath, proposal.after)
        }
      } catch (err) {
        // A changed file keeps the proposal so Reject still works; any other
        // failure (access denied, file gone) ends it.
        if (!(err instanceof Error && err.message === CHANGED_SINCE_PROPOSAL)) held.delete(id)
        throw err
      }
      held.delete(id)
      return { relPath: proposal.relPath }
    },

    reject(id) {
      held.delete(id)
    },

    clear() {
      held.clear()
    }
  }
}
