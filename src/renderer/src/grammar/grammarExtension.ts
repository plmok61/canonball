import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { MAX_LINT_CHARS } from '../../../shared/grammar'
import type { GrammarLint } from '../../../shared/types'
import { collectBlocks, toDocRange } from './blocks'

export interface GrammarOptions {
  lint: (texts: string[]) => Promise<GrammarLint[][]>
  delayMs: number
}

interface GrammarStorage {
  /** `${problem}\0${message}` keys the writer ignored this session (never saved). */
  ignored: Set<string>
}

declare module '@tiptap/core' {
  interface Storage {
    grammar: GrammarStorage
  }
}

export interface FoundLint {
  from: number
  to: number
  lint: GrammarLint
}

export const grammarKey = new PluginKey<DecorationSet>('grammar')

/** The lint cache (block text → lints) is cleared once it passes this many entries. */
const CACHE_LIMIT = 2000

/** Split texts, in order, into batches of at most MAX_LINT_CHARS in total. */
function toBatches(texts: string[]): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let size = 0
  for (const text of texts) {
    if (current.length > 0 && size + text.length > MAX_LINT_CHARS) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(text)
    size += text.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

function ignoreKey(lint: GrammarLint): string {
  return `${lint.problem}\0${lint.message}`
}

function buildDecorations(
  doc: ProseMirrorNode,
  perBlock: { block: ReturnType<typeof collectBlocks>[number]; lints: GrammarLint[] }[],
  ignored: Set<string>
): DecorationSet {
  const decorations: Decoration[] = []
  for (const { block, lints } of perBlock) {
    for (const lint of lints) {
      if (ignored.has(ignoreKey(lint))) continue
      const range = toDocRange(block, lint.start, lint.end)
      if (!range) continue
      decorations.push(Decoration.inline(range.from, range.to, { class: 'cb-grammar' }, { lint }))
    }
  }
  return DecorationSet.create(doc, decorations)
}

/** Replace the decoration set without touching the doc or undo history. */
function setDecorations(view: EditorView, set: DecorationSet): void {
  view.dispatch(view.state.tr.setMeta(grammarKey, set).setMeta('addToHistory', false))
}

/**
 * Underlines what the grammar checker flags. It only flags: the writer applies
 * every fix through `applyGrammarSuggestion`.
 */
export const Grammar = Extension.create<GrammarOptions, GrammarStorage>({
  name: 'grammar',

  addOptions() {
    return {
      lint: async (texts) => texts.map(() => []),
      delayMs: 400
    }
  },

  addStorage() {
    return { ignored: new Set<string>() }
  },

  addProseMirrorPlugins() {
    const { lint, delayMs } = this.options
    const storage = this.storage
    const cache = new Map<string, GrammarLint[]>()

    return [
      new Plugin<DecorationSet>({
        key: grammarKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(grammarKey) as DecorationSet | undefined
            return next ?? set.map(tr.mapping, tr.doc)
          }
        },
        props: {
          decorations: (state) => grammarKey.getState(state)
        },
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined
          let destroyed = false

          const remember = (texts: string[], results: GrammarLint[][]): void => {
            if (cache.size + texts.length > CACHE_LIMIT) cache.clear()
            texts.forEach((text, i) => cache.set(text, results[i] ?? []))
          }

          // Runs may overlap: a hung request must not hold up later edits, and
          // each run drops its own result if the doc has moved on.
          const lintAndDecorate = async (): Promise<void> => {
            const doc = view.state.doc
            const blocks = collectBlocks(doc)
            const missing = [
              ...new Set(blocks.map((b) => b.text).filter((t) => t && !cache.has(t)))
            ]
            // Kept apart from the cache, which may be cleared mid-run.
            const fresh = new Map<string, GrammarLint[]>()
            // A paragraph too long for one request is not checked.
            const tooLong = missing.filter((t) => t.length > MAX_LINT_CHARS)
            tooLong.forEach((text) => fresh.set(text, []))
            remember(tooLong, [])
            // Main rejects requests over the cap, so big files go in batches.
            for (const batch of toBatches(missing.filter((t) => t.length <= MAX_LINT_CHARS))) {
              if (destroyed || view.isDestroyed) return
              let results: GrammarLint[][]
              try {
                results = await lint(batch)
              } catch (error) {
                console.warn('Grammar check failed:', error)
                return
              }
              batch.forEach((text, i) => fresh.set(text, results[i] ?? []))
              remember(batch, results)
            }
            const perBlock = blocks.map((block) => ({
              block,
              lints: fresh.get(block.text) ?? cache.get(block.text) ?? []
            }))

            if (destroyed || view.isDestroyed || view.state.doc !== doc) return
            setDecorations(view, buildDecorations(doc, perBlock, storage.ignored))
          }

          const run = async (): Promise<void> => {
            try {
              await lintAndDecorate()
            } catch (error) {
              console.warn('Grammar check failed:', error)
            }
          }

          const schedule = (): void => {
            clearTimeout(timer)
            timer = setTimeout(() => void run(), delayMs)
          }

          schedule()
          return {
            update(view, prevState) {
              // Identity, to match the stale check in `run`: any new doc gets a run.
              if (view.state.doc !== prevState.doc) schedule()
            },
            destroy() {
              destroyed = true
              clearTimeout(timer)
            }
          }
        }
      })
    ]
  }
})

/** The underlined lint at `pos` (inside it or at its edges), if any. */
export function grammarLintAt(state: EditorState, pos: number): FoundLint | null {
  const set = grammarKey.getState(state)
  if (!set) return null
  const hits = set.find(pos, pos).filter((d) => d.from <= pos && pos <= d.to)
  const hit = hits.find((d) => pos < d.to) ?? hits[0]
  return hit ? { from: hit.from, to: hit.to, lint: hit.spec.lint as GrammarLint } : null
}

/**
 * Replace the flagged text with `replacement` as a normal, undoable edit.
 * Returns false (and changes nothing) if the text there is no longer the
 * flagged text.
 */
export function applyGrammarSuggestion(
  editor: Editor,
  found: FoundLint,
  replacement: string
): boolean {
  const { state } = editor
  const { from, to, lint } = found
  if (from < 0 || to > state.doc.content.size || from >= to) return false
  if (state.doc.textBetween(from, to) !== lint.problem) return false
  const tr = replacement ? state.tr.insertText(replacement, from, to) : state.tr.delete(from, to)
  editor.view.dispatch(tr)
  return true
}

/** Hide this lint (same problem and message) for the rest of the session. */
export function ignoreGrammarLint(editor: Editor, found: FoundLint): void {
  const key = ignoreKey(found.lint)
  editor.storage.grammar.ignored.add(key)
  const set = grammarKey.getState(editor.state)
  if (!set) return
  const matching = set.find(undefined, undefined, (spec) => ignoreKey(spec.lint) === key)
  if (matching.length > 0) setDecorations(editor.view, set.remove(matching))
}
