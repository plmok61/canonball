/**
 * Brainstorm-session context: the stance, the goal, the previous session's
 * "Next Session" and (for the end request) the log-writing rules. Pure text
 * building; proposals reuse Phase 5's tools and tags.
 */
import type { SessionRequest } from '../../shared/ai'
import type { AiAccess } from '../aiAccess'
import { FALLBACK_BUDGET, packFiles } from './fallback'

export const SESSION_STANCE =
  "This is a brainstorm session. Open doors rather than closing them. Offer several directions, argue for the ones you find most interesting and say why. Ask questions that make the writer commit to a choice. Don't resolve things before the writer does, and don't treat an idea as settled until the writer says it is. You have already read the canon and notes included in these instructions, so build on them, and point out when an idea contradicts them."

export const BUILTIN_SESSION_TEMPLATE = `# Session [N] — [Date]

## Goals
<!-- What I wanted to accomplish this session -->

## Decisions Made
<!-- Any canon decisions locked in — move the important ones to canon/ after the session -->

## What Was Written
<!-- Files touched, drafts created or updated -->

## Open Questions
<!-- Unresolved questions to address next session -->

## Next Session
<!-- Where to pick up — what to do first -->
`

export const NEXT_SESSION_CAP = 4000

const TEMPLATE_REL = 'sessions/session-template.md'
const HEADING_RE = /^(#{1,6})\s*(.*?)\s*$/
const NEXT_RE = /^#{1,6}\s*Next Session\s*$/i
const numeric = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true })

export function nextSessionSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((l) => NEXT_RE.test(l))
  if (start === -1) return ''
  const level = HEADING_RE.exec(lines[start])![1].length
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    const m = HEADING_RE.exec(line)
    if (m && m[1].length <= level) break
    body.push(line)
  }
  return body
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .slice(0, NEXT_SESSION_CAP)
}

export async function sessionLogs(access: AiAccess): Promise<string[]> {
  return (await access.list())
    .map((f) => f.relPath)
    .filter((p) => /^sessions\/[^/]+\.md$/.test(p))
    .filter((p) => p !== 'sessions/README.md' && p !== TEMPLATE_REL)
    .sort(numeric)
}

export function nextLogNumber(logs: string[]): number {
  let max = 0
  for (const p of logs) {
    const m = /^sessions\/session-(\d+)\.md$/.exec(p)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max + 1
}

export function localDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function sessionEndInstructions(opts: {
  mode: 'tools' | 'fallback'
  logPath: string
  n: number
  date: string
  template: string
}): string {
  const how =
    opts.mode === 'tools'
      ? 'Use create_note for the log and propose_edit for the canon changes.'
      : 'Use the canonball-create tag for the log and the canonball-edit tag for the canon changes.'
  return [
    `The writer has ended the session. First, suggest a new file at ${opts.logPath} that logs this session using the template below.`,
    `Replace [N] with ${opts.n} and [Date] with ${opts.date}, fill in every section from this conversation, and remove the HTML comments. Under What Was Written, list only files that were actually changed or suggested in this session. If nothing was, write "Nothing yet."`,
    `Then, for each decision the writer clearly locked in (not ideas still open), suggest one change to the matching canon/ file: one suggestion per decision, even when two decisions go to the same file. Skip decisions that canon already records. Use the canon/ file that fits best, or suggest a new one there if none fits.`,
    how,
    `After the suggestions, tell the writer in one or two sentences what you suggested. They will accept or reject each card.`,
    `Template:\n${opts.template}`
  ].join('\n\n')
}

export async function buildSessionBlock(opts: {
  access: AiAccess
  session: SessionRequest
  mode: 'tools' | 'fallback'
  isProtected: (relPath: string) => boolean
  now: Date
}): Promise<string> {
  const { access, session, mode } = opts
  const parts = [SESSION_STANCE, `The writer's goal for this session: ${session.goal}`]
  const logs = await sessionLogs(access)

  const last = logs[logs.length - 1]
  if (last) {
    try {
      const next = nextSessionSection((await access.read(last)).content)
      if (next) parts.push(`Where the last session (${last}) said to pick up:\n${next}`)
    } catch {
      // unreadable log: skip silently
    }
  }

  if (session.phase === 'end') {
    let template = BUILTIN_SESSION_TEMPLATE
    try {
      template = (await access.read(TEMPLATE_REL)).content
    } catch {
      // missing: use the built-in copy
    }
    const n = nextLogNumber(logs)
    parts.push(
      sessionEndInstructions({
        mode,
        logPath: `sessions/session-${n}.md`,
        n,
        date: localDate(opts.now),
        template
      })
    )
  }

  if (mode === 'tools') {
    const packed = await packFiles(
      access,
      opts.isProtected,
      FALLBACK_BUDGET,
      (p) => p.startsWith('canon/') || p.startsWith('notes/')
    )
    if (packed) parts.push(`The readable canon and notes:\n${packed}`)
  }
  return parts.join('\n\n')
}
