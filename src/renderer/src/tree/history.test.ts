import { describe, expect, it, vi } from 'vitest'
import { createHistory, type History, type Step } from './history'
import type { TrashedItem } from '../../../shared/types'

const tree = [] as never[]
const protection = { entries: [] } as never
const ok = { tree, protection }
const item: TrashedItem = { id: 'x', from: 'a.md', protectedEntries: [] }

function setup(): {
  api: Record<string, ReturnType<typeof vi.fn>>
  onResult: ReturnType<typeof vi.fn>
  h: History
} {
  const api = {
    moveExact: vi.fn().mockResolvedValue(ok),
    restoreEntries: vi.fn().mockResolvedValue(ok),
    removeCreated: vi.fn().mockResolvedValue({ ...ok, trashed: [item] }),
    applyProtectionDelta: vi
      .fn()
      .mockResolvedValue({ protection, applied: { added: ['p'], removed: [] } }),
    trashEntries: vi.fn().mockResolvedValue({ ...ok, trashed: [{ ...item, id: 'y' }] })
  }
  const onResult = vi.fn()
  return { api, onResult, h: createHistory('/root', api, onResult) }
}

const rename: Step = { kind: 'move', label: 'Rename', moves: [{ from: 'a.md', to: 'b.md' }] }

describe('history', () => {
  it('undo of a rename moves it back, redo moves it forward', async () => {
    const { h, api, onResult } = setup()
    h.push(rename)
    expect(await h.undo()).toEqual(rename)
    expect(api.moveExact).toHaveBeenCalledWith('/root', [{ from: 'b.md', to: 'a.md' }])
    expect(onResult).toHaveBeenCalledTimes(1)
    await h.redo()
    expect(api.moveExact).toHaveBeenLastCalledWith('/root', [{ from: 'a.md', to: 'b.md' }])
  })

  it('reverses multiple moves in reverse order', async () => {
    const { h, api } = setup()
    h.push({
      kind: 'move',
      label: 'Move',
      moves: [
        { from: 'a', to: 'b' },
        { from: 'b2', to: 'c' }
      ]
    })
    await h.undo()
    expect(api.moveExact).toHaveBeenCalledWith('/root', [
      { from: 'c', to: 'b2' },
      { from: 'b', to: 'a' }
    ])
  })

  it('undo of trash restores; redo trashes again with the new items', async () => {
    const { h, api } = setup()
    h.push({ kind: 'trash', label: 'Delete', items: [item] })
    await h.undo()
    expect(api.restoreEntries).toHaveBeenCalledWith('/root', [item])
    await h.redo()
    expect(api.trashEntries).toHaveBeenCalledWith('/root', ['a.md'])
    await h.undo()
    expect(api.restoreEntries).toHaveBeenLastCalledWith('/root', [{ ...item, id: 'y' }])
  })

  it('undo of a create removes it, redo restores it', async () => {
    const { h, api } = setup()
    h.push({ kind: 'create', label: 'New file', created: ['a.md'] })
    expect(h.peekUndo()).toMatchObject({ kind: 'create' })
    await h.undo()
    expect(api.removeCreated).toHaveBeenCalledWith('/root', ['a.md'])
    expect(h.canRedo()).toBe(true)
    await h.redo()
    expect(api.restoreEntries).toHaveBeenCalledWith('/root', [item])
    expect(h.peekUndo()).toMatchObject({ kind: 'create', created: ['a.md'] })
  })

  it('undo of protect applies the reverse delta', async () => {
    const { h, api, onResult } = setup()
    h.push({ kind: 'protect', label: 'Protect', delta: { added: ['p'], removed: ['q'] } })
    await h.undo()
    expect(api.applyProtectionDelta).toHaveBeenCalledWith('/root', { added: ['q'], removed: ['p'] })
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ protection }))
    await h.redo()
    expect(api.applyProtectionDelta).toHaveBeenLastCalledWith('/root', {
      added: ['p'],
      removed: ['q']
    })
  })

  it('a protect undo that applies nothing is dropped and rejected', async () => {
    const { h, api } = setup()
    api.applyProtectionDelta.mockResolvedValue({
      protection,
      applied: { added: [], removed: [] }
    })
    h.push({ kind: 'protect', label: 'Protect', delta: { added: ['p'], removed: [] } })
    await expect(h.undo()).rejects.toThrow("Can't undo: the protection has already changed")
    expect(h.canUndo()).toBe(false)
  })

  it('a failed undo drops the step and reports', async () => {
    const { h, api } = setup()
    api.moveExact.mockRejectedValue(
      new Error(
        'Error invoking remote method \'canonball:moveExact\': Error: "a.md" already exists'
      )
    )
    h.push(rename)
    await expect(h.undo()).rejects.toThrow('Can\'t undo: "a.md" already exists')
    expect(h.canUndo()).toBe(false)
  })

  it('a failed redo drops the step', async () => {
    const { h, api } = setup()
    h.push(rename)
    await h.undo()
    api.moveExact.mockRejectedValue(new Error('nope'))
    await expect(h.redo()).rejects.toThrow("Can't redo: nope")
    expect(h.canRedo()).toBe(false)
  })

  it('a new push clears redo', async () => {
    const { h } = setup()
    h.push(rename)
    await h.undo()
    expect(h.canRedo()).toBe(true)
    h.push(rename)
    expect(h.canRedo()).toBe(false)
  })

  it('returns null when empty and ignores a concurrent call', async () => {
    const { h, api } = setup()
    expect(await h.undo()).toBeNull()
    h.push(rename)
    h.push(rename)
    const [a, b] = await Promise.all([h.undo(), h.undo()])
    expect(a).not.toBeNull()
    expect(b).toBeNull()
    expect(api.moveExact).toHaveBeenCalledTimes(1)
  })

  it('clear empties both stacks', async () => {
    const { h } = setup()
    h.push(rename)
    await h.undo()
    h.clear()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })
})
