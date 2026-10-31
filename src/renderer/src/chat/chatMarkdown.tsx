import type { ReactNode } from 'react'

/**
 * Renders the small markdown subset replies use (paragraphs, `#` headings,
 * `-`/`*`/`1.` lists, `**bold**`, `*italic*`/`_italic_`, `` `code` ``) as React
 * elements. Everything else stays plain text; nothing goes through innerHTML.
 */

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/

// code | bold | *italic* | _italic_ (not inside a word)
const INLINE =
  /`([^`\n]+)`|\*\*(?=\S)(.+?)\*\*|\*(?=[^\s*])([^*\n]+?)\*|(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]+?)_(?![\p{L}\p{N}_])/u

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  let rest = text
  let i = 0
  for (;;) {
    const m = INLINE.exec(rest)
    if (!m) break
    if (m.index > 0) out.push(rest.slice(0, m.index))
    const k = `${key}-${i++}`
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>)
    else if (m[2] !== undefined) out.push(<strong key={k}>{inline(m[2], k)}</strong>)
    else out.push(<em key={k}>{inline(m[3] ?? m[4], k)}</em>)
    rest = rest.slice(m.index + m[0].length)
  }
  if (rest !== '') out.push(rest)
  return out
}

function withBreaks(lines: string[], key: string): ReactNode[] {
  const out: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${key}-br${i}`} />)
    out.push(...inline(line, `${key}-${i}`))
  })
  return out
}

export function renderChatMarkdown(text: string): ReactNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushPara = (): void => {
    if (para.length === 0) return
    const k = `b${blocks.length}`
    blocks.push(<p key={k}>{withBreaks(para, k)}</p>)
    para = []
  }
  const flushList = (): void => {
    if (!list) return
    const k = `b${blocks.length}`
    const items = list.items.map((item, i) => (
      <li key={`${k}-${i}`}>{inline(item, `${k}-${i}`)}</li>
    ))
    blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k}>{items}</ul>)
    list = null
  }

  for (const line of lines) {
    if (line.trim() === '') {
      flushPara()
      flushList()
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      flushPara()
      flushList()
      const k = `b${blocks.length}`
      // Reply headings sit below the app's own, so # becomes h3.
      const level = Math.min(6, h[1].length + 2)
      const Tag = `h${level}` as 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(<Tag key={k}>{inline(h[2], k)}</Tag>)
      continue
    }
    const b = BULLET.exec(line)
    const n = b ? null : NUMBERED.exec(line)
    if (b || n) {
      flushPara()
      const ordered = !!n
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, items: [] }
      list.items.push((b ?? n)![1])
      continue
    }
    if (list) {
      // A plain line right after an item continues that item.
      list.items[list.items.length - 1] += ' ' + line.trim()
      continue
    }
    para.push(line)
  }
  flushPara()
  flushList()
  return blocks
}
