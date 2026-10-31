import { EventEmitter } from 'events'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('logs a fatal error without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { children, svc } = setup()
    const p = svc.lint(['x'])
    expect(() => children[0].emit('error', 'FatalError', 'crash')).not.toThrow()
    expect(warn).toHaveBeenCalled()
    children[0].emit('exit', 1)
    await expect(p).rejects.toThrow('Grammar checker stopped')
  })

  it('rejects a reply with neither lints nor error', async () => {
    const { children, svc } = setup()
    const p = svc.lint(['x'])
    children[0].emit('message', { id: children[0].sent[0].id })
    await expect(p).rejects.toThrow('Invalid grammar reply')
  })

  it('rejects a request whose postMessage throws, and forgets it', async () => {
    const { children, svc } = setup()
    void svc.lint(['warm']).catch(() => {})
    children[0].postMessage = () => {
      throw new Error('channel closed')
    }
    await expect(svc.lint(['x'])).rejects.toThrow('channel closed')
  })

  it("an old child's exit does not reject a newer child's requests", async () => {
    const { children, svc } = setup()
    const old = svc.lint(['x'])
    children[0].emit('exit', 1)
    await expect(old).rejects.toThrow('Grammar checker stopped')
    const p = svc.lint(['y'])
    expect(children).toHaveLength(2)
    // A late second exit from the old child must not touch the new request.
    children[0].emit('exit', 1)
    children[1].emit('message', { id: children[1].sent[0].id, lints: [[]] })
    await expect(p).resolves.toEqual([[]])
  })

  it("a disposed child's late exit does not reject the new child's requests", async () => {
    const { children, svc } = setup()
    void svc.lint(['x']).catch(() => {})
    svc.dispose()
    const p = svc.lint(['y'])
    expect(children).toHaveLength(2)
    children[0].emit('exit', 0)
    children[1].emit('message', { id: children[1].sent[0].id, lints: [[]] })
    await expect(p).resolves.toEqual([[]])
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
