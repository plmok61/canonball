import { cleanIpcMessage } from '../../../shared/ipcError'
import type {
  CanonballApi,
  FileOpResult,
  Move,
  ProjectProtection,
  ProtectionDelta,
  TrashedItem
} from '../../../shared/types'

export type Step =
  | { kind: 'create'; label: string; created: string[] }
  | { kind: 'move'; label: string; moves: Move[] }
  | { kind: 'trash'; label: string; items: TrashedItem[] }
  | { kind: 'protect'; label: string; delta: ProtectionDelta }
  /** An undone create, held on the redo stack. Internal. */
  | { kind: 'removed'; label: string; items: TrashedItem[] }

/** What a successful undo or redo reports; protection-only changes carry no tree. */
export type HistoryResult = { tree?: FileOpResult['tree']; protection: ProjectProtection }

export interface History {
  push(step: Step): void
  undo(): Promise<Step | null>
  redo(): Promise<Step | null>
  /** The step `undo()` would act on, without changing anything. */
  peekUndo(): Step | null
  canUndo(): boolean
  canRedo(): boolean
  clear(): void
}

type Api = Pick<
  CanonballApi,
  'moveExact' | 'restoreEntries' | 'removeCreated' | 'applyProtectionDelta' | 'trashEntries'
>

const empty = (d: ProtectionDelta): boolean => d.added.length === 0 && d.removed.length === 0

export function createHistory(
  root: string,
  api: Api,
  onResult: (r: HistoryResult) => void
): History {
  let undoStack: Step[] = []
  let redoStack: Step[] = []
  let busy = false

  /** Reverse a step; returns the result and the step to put on the other stack. */
  async function reverse(step: Step): Promise<[HistoryResult, Step]> {
    switch (step.kind) {
      case 'create': {
        const r = await api.removeCreated(root, step.created)
        return [r, { kind: 'removed', label: step.label, items: r.trashed }]
      }
      case 'move': {
        const moves = step.moves.map((m) => ({ from: m.to, to: m.from })).reverse()
        return [await api.moveExact(root, moves), step]
      }
      case 'trash':
        return [await api.restoreEntries(root, step.items), step]
      case 'protect': {
        const r = await api.applyProtectionDelta(root, {
          added: step.delta.removed,
          removed: step.delta.added
        })
        if (empty(r.applied)) throw new Error('the protection has already changed')
        return [r, step]
      }
      case 'removed':
        throw new Error('nothing to undo')
    }
  }

  async function reapply(step: Step): Promise<[HistoryResult, Step]> {
    switch (step.kind) {
      case 'removed': {
        const r = await api.restoreEntries(root, step.items)
        return [r, { kind: 'create', label: step.label, created: step.items.map((i) => i.from) }]
      }
      case 'move':
        return [await api.moveExact(root, step.moves), step]
      case 'trash': {
        const r = await api.trashEntries(
          root,
          step.items.map((i) => i.from)
        )
        return [r, { ...step, items: r.trashed }]
      }
      case 'protect': {
        const r = await api.applyProtectionDelta(root, step.delta)
        if (empty(r.applied)) throw new Error('the protection has already changed')
        return [r, step]
      }
      case 'create':
        throw new Error('nothing to redo')
    }
  }

  async function run(
    from: Step[],
    to: Step[],
    act: (s: Step) => Promise<[HistoryResult, Step]>,
    verb: string
  ): Promise<Step | null> {
    if (busy || from.length === 0) return null
    busy = true
    const step = from.pop() as Step
    try {
      const [result, next] = await act(step)
      to.push(next)
      onResult(result)
      return step
    } catch (e) {
      const msg = cleanIpcMessage(e instanceof Error ? e.message : String(e))
      throw new Error(`Can't ${verb}: ${msg}`, { cause: e })
    } finally {
      busy = false
    }
  }

  return {
    push(step) {
      undoStack.push(step)
      redoStack = []
    },
    undo: () => run(undoStack, redoStack, reverse, 'undo'),
    redo: () => run(redoStack, undoStack, reapply, 'redo'),
    peekUndo: () => undoStack[undoStack.length - 1] ?? null,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    clear() {
      undoStack = []
      redoStack = []
    }
  }
}
