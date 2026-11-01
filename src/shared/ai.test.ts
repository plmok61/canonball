import { describe, expect, it } from 'vitest'
import {
  chatTitle,
  mergeTurns,
  normalizeLocalUrl,
  parseChatRequest,
  parseChatThread,
  parseModelChoice,
  sessionTitle,
  turnsForModel
} from './ai'
import type { Proposal } from './proposals'

const ID = '123e4567-e89b-12d3-a456-426614174000'

function thread(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: ID,
    title: 'Hello',
    createdAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:01:00.000Z',
    messages: [
      { role: 'user', content: 'Hi', at: '2026-10-31T10:00:00.000Z' },
      {
        role: 'assistant',
        content: 'Hello',
        at: '2026-10-31T10:01:00.000Z',
        model: { provider: 'local', model: 'llama3' }
      }
    ],
    ...over
  }
}

describe('normalizeLocalUrl', () => {
  it('normalizes local URLs', () => {
    expect(normalizeLocalUrl('http://localhost:11434')).toBe('http://localhost:11434/v1')
    expect(normalizeLocalUrl('http://localhost:1234/v1/')).toBe('http://localhost:1234/v1')
    expect(normalizeLocalUrl('https://box.lan:8080/api')).toBe('https://box.lan:8080/api/v1')
    expect(() => normalizeLocalUrl('localhost:11434')).toThrow(
      'Enter a URL starting with http:// or https://'
    )
    expect(() => normalizeLocalUrl('ftp://x')).toThrow(
      'Enter a URL starting with http:// or https://'
    )
  })
})

describe('chatTitle', () => {
  it('titles from the first message', () => {
    expect(chatTitle('  Where   does\nshe go?  ')).toBe('Where does she go?')
    const t = chatTitle('x'.repeat(100))
    expect(t).toHaveLength(60)
    expect(t.endsWith('…')).toBe(true)
  })
})

describe('mergeTurns', () => {
  it('merges consecutive same-role turns', () => {
    expect(
      mergeTurns([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' }
      ])
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' }
    ])
  })
})

describe('parseModelChoice', () => {
  it('accepts known providers only', () => {
    expect(parseModelChoice({ provider: 'openai', model: 'gpt-5' })).toEqual({
      provider: 'openai',
      model: 'gpt-5'
    })
    expect(parseModelChoice({ provider: 'x', model: 'm' })).toBeNull()
    expect(parseModelChoice({ provider: 'local', model: '' })).toBeNull()
    expect(parseModelChoice(null)).toBeNull()
  })
})

describe('parseChatThread', () => {
  it('accepts a valid thread and rejects wrong shapes', () => {
    expect(parseChatThread(thread())).toEqual(thread())
    expect(parseChatThread(thread({ id: 'nope' }))).toBeNull()
    expect(parseChatThread(thread({ id: '../../x' }))).toBeNull()
    expect(parseChatThread(thread({ version: 2 }))).toBeNull()
    expect(
      parseChatThread(thread({ messages: [{ role: 'system', content: 'x', at: 'y' }] }))
    ).toBeNull()
    expect(
      parseChatThread(thread({ messages: [{ role: 'user', content: 5, at: 'y' }] }))
    ).toBeNull()
    expect(
      parseChatThread(
        thread({
          messages: [{ role: 'user', content: 'x', at: 'y', model: { provider: 'zzz', model: 'm' } }]
        })
      )
    ).toBeNull()
    expect(parseChatThread('str')).toBeNull()
  })
})

describe('parseChatRequest', () => {
  const ok = {
    requestId: 'req-1',
    model: { provider: 'anthropic', model: 'claude-x' },
    messages: [{ role: 'user', content: 'hi' }]
  }
  it('requires a final user turn', () => {
    expect(parseChatRequest(ok)).toEqual(ok)
    expect(parseChatRequest({ ...ok, messages: [] })).toBeNull()
    expect(
      parseChatRequest({
        ...ok,
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'yo' }
        ]
      })
    ).toBeNull()
    expect(parseChatRequest({ ...ok, requestId: '' })).toBeNull()
    expect(parseChatRequest({ ...ok, requestId: 5 })).toBeNull()
    expect(parseChatRequest({ ...ok, model: { provider: 'bad', model: 'm' } })).toBeNull()
  })
})

describe('proposals in threads', () => {
  const prop: Proposal = {
    id: ID,
    kind: 'edit',
    relPath: 'notes/ideas.md',
    before: 'a',
    after: 'b',
    status: 'accepted'
  }
  const withProps = (proposals: unknown): Record<string, unknown> =>
    thread({
      messages: [{ role: 'assistant', content: 'Done', at: '2026-10-31T10:00:00.000Z', proposals }]
    })

  it('parseChatThread keeps valid proposals and rejects invalid ones', () => {
    const ok = parseChatThread(withProps([prop]))
    expect(ok?.messages[0].proposals).toEqual([prop])
    expect(parseChatThread(withProps([{ ...prop, status: 'maybe' }]))).toBeNull()
    expect(parseChatThread(withProps('nope'))).toBeNull()
  })

  it('turnsForModel appends proposal notes to assistant turns', () => {
    const turns = turnsForModel([
      { role: 'user', content: 'Fix it', at: 'x' },
      { role: 'assistant', content: 'Done', at: 'x', proposals: [prop] },
      { role: 'assistant', content: 'Plain', at: 'x' }
    ])
    expect(turns).toEqual([
      { role: 'user', content: 'Fix it' },
      { role: 'assistant', content: 'Done\n\n[Suggested an edit to notes/ideas.md: accepted]' },
      { role: 'assistant', content: 'Plain' }
    ])
  })
})

describe('sessions', () => {
  const req = {
    requestId: 'req-1',
    model: { provider: 'anthropic', model: 'claude-x' },
    messages: [{ role: 'user', content: 'hi' }]
  }

  it('parseChatThread keeps a valid session and rejects a bad one', () => {
    expect(parseChatThread(thread())).not.toHaveProperty('session')
    expect(parseChatThread(thread({ session: { goal: 'Ship' } }))?.session).toEqual({
      goal: 'Ship'
    })
    const ended = { goal: 'Ship', endedAt: '2026-10-31T11:00:00.000Z' }
    expect(parseChatThread(thread({ session: ended }))?.session).toEqual(ended)
    expect(parseChatThread(thread({ session: { goal: '' } }))).toBeNull()
    expect(parseChatThread(thread({ session: { goal: 3 } }))).toBeNull()
    expect(parseChatThread(thread({ session: { goal: 'x', endedAt: 5 } }))).toBeNull()
    expect(parseChatThread(thread({ session: 'x' }))).toBeNull()
  })

  it('parseChatRequest validates the session field', () => {
    const brainstorm = { goal: 'Ship', phase: 'brainstorm' }
    const end = { goal: 'Ship', phase: 'end' }
    expect(parseChatRequest({ ...req, session: brainstorm })?.session).toEqual(brainstorm)
    expect(parseChatRequest({ ...req, session: end })?.session).toEqual(end)
    expect(parseChatRequest({ ...req, session: { goal: 'Ship', phase: 'later' } })).toBeNull()
    expect(parseChatRequest({ ...req, session: { goal: '  ', phase: 'end' } })).toBeNull()
    expect(
      parseChatRequest({ ...req, session: { goal: 'x'.repeat(2001), phase: 'end' } })
    ).toBeNull()
    expect(parseChatRequest(req)).not.toHaveProperty('session')
  })

  it('sessionTitle prefixes and truncates', () => {
    expect(sessionTitle('the ship')).toBe('Brainstorm: the ship')
    const t = sessionTitle('x'.repeat(100))
    expect(t).toHaveLength(60)
    expect(t.endsWith('…')).toBe(true)
  })
})
