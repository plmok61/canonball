/**
 * Prompt fallback for models without tool calling: packs the readable files into the
 * prompt and filters the model's tagged edit blocks out of its streamed reply.
 * Pure: it creates no proposals itself.
 */
import type { AiAccess } from '../aiAccess'
import type { EditSpec } from './proposals'

export const FALLBACK_BUDGET = 24_000

const GROUP_ORDER = ['canon/', 'notes/', 'outline/', 'sessions/']

function groupOf(relPath: string, prose: (relPath: string) => boolean): number {
  if (prose(relPath)) return GROUP_ORDER.length + 1
  const i = GROUP_ORDER.findIndex((prefix) => relPath.startsWith(prefix))
  return i === -1 ? GROUP_ORDER.length : i
}

export async function packFiles(
  access: AiAccess,
  prose: (relPath: string) => boolean,
  budget: number = FALLBACK_BUDGET
): Promise<string> {
  const files = (await access.list())
    .filter((f) => !f.relPath.startsWith('memory/')) // already in the instructions
    .map((f) => ({ ...f, group: groupOf(f.relPath, prose) }))
    .sort((a, b) => a.group - b.group || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))

  const included: string[] = []
  const skipped: string[] = []
  let used = 0
  for (const f of files) {
    let content: string
    try {
      content = (await access.read(f.relPath)).content
    } catch {
      continue // hidden or vanished since list()
    }
    const entry = `<file path="${f.relPath}" access="${f.access}">\n${content}\n</file>`
    if (used + entry.length > budget) {
      skipped.push(f.relPath)
      continue
    }
    used += entry.length
    included.push(entry)
  }
  if (skipped.length > 0) included.push(`Not included (too long to fit): ${skipped.join(', ')}`)
  return included.join('\n\n')
}

export type FallbackBlock =
  | { kind: 'edit'; relPath: string; edits: EditSpec[] }
  | { kind: 'create'; relPath: string; content: string }
  | { kind: 'invalid'; reason: string }

export interface BlockFilter {
  /** Text safe to show now. */
  push(chunk: string): string
  /** Flushes; an unclosed tag is dropped as invalid. */
  end(): { text: string; blocks: FallbackBlock[] }
}

const OPEN = '<canonball-'
const CLOSE_RE = /<\/canonball-[a-z]+>/
const OPEN_TAG_RE = /^<canonball-(edit|create)((?:\s+[a-z]+="[^"]*")*)\s*>/
const PAIR_RE = /<old>([\s\S]*?)<\/old>\s*<new>([\s\S]*?)<\/new>/g

/** One leading and one trailing newline are formatting, not content. */
function trimOneNewline(s: string): string {
  return s.replace(/^\r?\n/, '').replace(/\r?\n$/, '')
}

function parseBlock(raw: string): FallbackBlock {
  const open = OPEN_TAG_RE.exec(raw)
  if (!open) return { kind: 'invalid', reason: 'unrecognised tag' }
  const closeAt = raw.search(CLOSE_RE)
  const body = raw.slice(open[0].length, closeAt)
  const pathMatch = /\spath="([^"]*)"/.exec(open[2])
  const relPath = pathMatch?.[1].trim()
  if (!relPath) return { kind: 'invalid', reason: 'missing path' }
  if (open[1] === 'create') return { kind: 'create', relPath, content: trimOneNewline(body) }
  const edits: EditSpec[] = []
  for (const m of body.matchAll(PAIR_RE)) {
    edits.push({ old_text: trimOneNewline(m[1]), new_text: trimOneNewline(m[2]) })
  }
  if (edits.length === 0) return { kind: 'invalid', reason: 'no old/new text' }
  return { kind: 'edit', relPath, edits }
}

export function createBlockFilter(): BlockFilter {
  let buf = '' // text mode: held possible tag prefix. tag mode: the tag so far.
  let inTag = false
  let blocks: FallbackBlock[] = []

  function drain(): string {
    let out = ''
    for (;;) {
      if (inTag) {
        const m = CLOSE_RE.exec(buf)
        if (!m) return out
        const end = m.index + m[0].length
        blocks.push(parseBlock(buf.slice(0, end)))
        buf = buf.slice(end)
        inTag = false
        continue
      }
      const lt = buf.indexOf('<')
      if (lt === -1) {
        out += buf
        buf = ''
        return out
      }
      out += buf.slice(0, lt)
      buf = buf.slice(lt)
      if (buf.startsWith(OPEN)) {
        inTag = true
      } else if (OPEN.startsWith(buf)) {
        return out // could still become a tag: hold it back
      } else {
        out += '<'
        buf = buf.slice(1)
      }
    }
  }

  return {
    push(chunk) {
      buf += chunk
      return drain()
    },
    end() {
      let text = ''
      if (inTag) blocks.push({ kind: 'invalid', reason: 'unclosed tag' })
      else text = buf
      buf = ''
      inTag = false
      const result = { text, blocks }
      blocks = []
      return result
    }
  }
}
