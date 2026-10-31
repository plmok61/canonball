import { EventEmitter } from 'events'
import { describe, expect, it } from 'vitest'
import {
  createGrammarService,
  MAX_LINT_CHARS,
  parseLintRequest,
  type GrammarChild
} from './grammarService'

class FakeChild extends EventEmitter implements GrammarChild {
  sent: Array<{ id: number; texts: string[] }> = []
  killed = false
  postMessage(msg: unknown): void {
    this.sent.push(msg as { id: number; texts: string[] })
  }
  kill(): boolean {
    this.killed = true
    return true
  }
}

function setup(): { children: FakeChild[]; svc: ReturnType<typeof createGrammarService> } {
  const children: FakeChild[] = []
  const svc = createGrammarService(() => {
    const c = new FakeChild()
    children.push(c)
    return c
  })
  return { children, svc }
}

describe('grammar service', () => {
  it('does not start the process until the first lint', () => {
    const { children, svc } = setup()
    expect(children).toHaveLength(0)
    void svc.lint(['a']).catch(() => {})
    expect(children).toHaveLength(1)
  })

  it('matches replies to requests by id', async () => {
    const { children, svc } = setup()
    const p1 = svc.lint(['one'])
    const p2 = svc.lint(['two'])
    const [m1, m2] = children[0].sent
    children[0].emit('message', { id: m2.id, lints: [[{ tag: 'two' }]] })
    children[0].emit('message', { id: m1.id, lints: [[{ tag: 'one' }]] })
    expect(await p1).toEqual([[{ tag: 'one' }]])
    expect(await p2).toEqual([[{ tag: 'two' }]])
  })

  it('rejects a request whose reply carries an error', async () => {
    const { children, svc } = setup()
    const p = svc.lint(['x'])
    children[0].emit('message', { id: children[0].sent[0].id, error: 'boom' })
    await expect(p).rejects.toThrow('boom')
  })

  it('rejects pending requests and restarts after the process exits', async () => {
    const { children, svc } = setup()
    const p = svc.lint(['x'])
    children[0].emit('exit', 1)
    await expect(p).rejects.toThrow('Grammar checker stopped')
    void svc.lint(['y']).catch(() => {})
    expect(children).toHaveLength(2)
  })

  it('dispose kills the child', () => {
    const { children, svc } = setup()
    void svc.lint(['x']).catch(() => {})
    svc.dispose()
    expect(children[0].killed).toBe(true)
  })
})

describe('parseLintRequest', () => {
  it('rejects non-arrays, non-strings and oversize requests', () => {
    expect(() => parseLintRequest('x')).toThrow('Invalid grammar request')
    expect(() => parseLintRequest([1])).toThrow('Invalid grammar request')
    expect(() => parseLintRequest(['a'.repeat(MAX_LINT_CHARS + 1)])).toThrow(
      'Invalid grammar request'
    )
    expect(parseLintRequest(['a', 'b'])).toEqual(['a', 'b'])
  })
})
