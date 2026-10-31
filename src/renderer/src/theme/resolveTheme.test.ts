import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { resolveTheme } from './resolveTheme'

describe('resolveTheme', () => {
  it('system follows systemDark', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
  it('explicit setting ignores system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

// Normalise quotes so the selector matches however prettier formats it.
const css = readFileSync(
  resolve(process.cwd(), 'src/renderer/src/theme/theme.css'),
  'utf8'
).replace(/'/g, '"')

function block(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`no ${selector} block`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('theme.css', () => {
  const dark = block('[data-theme="dark"]')
  const light = block(':root')
  const tokens = [
    '--bg',
    '--bg-sidebar',
    '--bg-chat',
    '--border',
    '--text',
    '--text-strong',
    '--text-muted',
    '--selection',
    '--accent-warn',
    '--accent-warn-bg'
  ]

  it('dark block has no pure white or black', () => {
    expect(dark).not.toMatch(/#(fff|ffffff|000|000000)\b/i)
    expect(dark).not.toMatch(/\b(white|black)\b/i)
  })
  it.each(tokens)('%s is defined in light and dark', (t) => {
    expect(light).toContain(`${t}:`)
    expect(dark).toContain(`${t}:`)
  })
})
