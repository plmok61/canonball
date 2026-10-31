export interface DiffLine {
  kind: 'same' | 'add' | 'del'
  text: string
}
export type DiffRow = DiffLine | { kind: 'gap' }

const MAX_CELLS = 4_000_000

function splitLines(s: string): string[] {
  return s === '' ? [] : s.split('\n')
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const out: DiffLine[] = []
  for (let i = 0; i < start; i++) out.push({ kind: 'same', text: a[i] })

  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  if (n * m > MAX_CELLS) {
    for (const t of midA) out.push({ kind: 'del', text: t })
    for (const t of midB) out.push({ kind: 'add', text: t })
  } else if (n === 0 || m === 0) {
    for (const t of midA) out.push({ kind: 'del', text: t })
    for (const t of midB) out.push({ kind: 'add', text: t })
  } else {
    // lcs[i][j] = LCS length of midA[i..] and midB[j..]
    const w = m + 1
    const lcs = new Uint32Array((n + 1) * w)
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * w + j + 1] + 1
            : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ kind: 'same', text: midA[i] })
        i++
        j++
      } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
        out.push({ kind: 'del', text: midA[i++] })
      } else {
        out.push({ kind: 'add', text: midB[j++] })
      }
    }
    while (i < n) out.push({ kind: 'del', text: midA[i++] })
    while (j < m) out.push({ kind: 'add', text: midB[j++] })
  }

  for (let i = endA; i < a.length; i++) out.push({ kind: 'same', text: a[i] })
  return out
}

export function collapseDiff(lines: DiffLine[], context = 2): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.kind === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) {
      keep[k] = true
    }
  })
  const rows: DiffRow[] = []
  let inGap = false
  lines.forEach((l, i) => {
    if (keep[i]) {
      rows.push(l)
      inGap = false
    } else if (!inGap) {
      rows.push({ kind: 'gap' })
      inGap = true
    }
  })
  return rows
}
