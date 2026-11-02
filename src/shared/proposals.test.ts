import { describe, expect, it } from 'vitest'
import { displayPath, parseProposal, proposalNote, type Proposal } from './proposals'

const ID = '123e4567-e89b-12d3-a456-426614174000'
const good: Proposal = {
  id: ID,
  kind: 'edit',
  relPath: 'notes/ideas.md',
  before: 'a',
  after: 'b',
  status: 'pending'
}

describe('parseProposal', () => {
  it('accepts a valid proposal and rejects bad shapes', () => {
    expect(parseProposal(good)).toEqual(good)
    expect(parseProposal({ ...good, status: 'failed', error: 'Nope' })).toEqual({
      ...good,
      status: 'failed',
      error: 'Nope'
    })
    expect(parseProposal({ ...good, id: 'x' })).toBeNull()
    expect(parseProposal({ ...good, kind: 'delete' })).toBeNull()
    expect(parseProposal({ ...good, status: 'maybe' })).toBeNull()
    expect(parseProposal({ ...good, after: 5 })).toBeNull()
    expect(parseProposal({ ...good, before: undefined })).toBeNull()
    expect(parseProposal({ ...good, relPath: '' })).toBeNull()
    expect(parseProposal({ ...good, error: 5 })).toBeNull()
    expect(parseProposal(null)).toBeNull()
  })
})

describe('displayPath', () => {
  it('strips .md', () => {
    expect(displayPath('notes/ideas.md')).toBe('notes/ideas')
    expect(displayPath('notes/a.txt')).toBe('notes/a.txt')
  })
})

describe('proposalNote', () => {
  it('describes the proposal and its status', () => {
    expect(proposalNote({ ...good, status: 'accepted' })).toBe(
      '[Suggested an edit to notes/ideas.md: accepted]'
    )
    expect(proposalNote({ ...good, kind: 'create', relPath: 'notes/x.md' })).toBe(
      '[Suggested a new file notes/x.md: pending]'
    )
  })
})
