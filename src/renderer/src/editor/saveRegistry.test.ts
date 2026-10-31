import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Autosave } from './autosave'
import { __resetSaveRegistryForTests, flushAll, orphan, settleOrphan } from './saveRegistry'

function stuckAutosave(save: () => Promise<void>): Autosave {
  const a = new Autosave({ delayMs: 10_000, save, initial: '', retryMs: 10_000 })
  a.change('unsaved text')
  return a
}

describe('save registry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    __resetSaveRegistryForTests()
  })
  afterEach(() => {
    __resetSaveRegistryForTests()
    vi.useRealTimers()
  })

  it('a stuck save is adopted when the same file in the same project reopens', async () => {
    const a = stuckAutosave(vi.fn().mockRejectedValue(new Error('disk')))
    orphan('/p1', 'canon/a.md', a)
    expect(await settleOrphan('/p1', 'canon/a.md')).toBe('unsaved text')
  })

  it('a stuck save is never adopted by the same path in another project', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk'))
    const a = stuckAutosave(save)
    orphan('/p1', 'canon/a.md', a)
    expect(await settleOrphan('/p2', 'canon/a.md')).toBeNull()
    await vi.advanceTimersByTimeAsync(0) // let the orphan's own first attempt fail
    const before = save.mock.calls.length
    await expect(flushAll(null)).rejects.toThrow()
    expect(save.mock.calls.length).toBeGreaterThan(before)
  })
})
