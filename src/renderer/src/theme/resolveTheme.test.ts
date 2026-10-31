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
    '--accent-warn-bg',
    '--active',
    '--active-text'
  ]

  it('dark block has no pure white or black', () => {
    expect(dark).not.toMatch(/#(fff|ffffff|000|000000)\b/i)
    expect(dark).not.toMatch(/\b(white|black)\b/i)
  })
  it.each(tokens)('%s is defined in light and dark', (t) => {
    expect(light).toContain(`${t}:`)
    expect(dark).toContain(`${t}:`)
  })

  describe.each([
    ['light', light],
    ['dark', dark]
  ])('%s contrast (WCAG)', (_name, body) => {
    const c = (fg: string, bg: string): number => contrast(token(body, fg), token(body, bg))

    it.each(['--bg', '--bg-sidebar', '--bg-chat'])('text and muted text on %s ≥ 4.5:1', (bg) => {
      expect(c('--text', bg)).toBeGreaterThanOrEqual(4.5)
      expect(c('--text-muted', bg)).toBeGreaterThanOrEqual(4.5)
    })
    it('text on --selection ≥ 4.5:1', () => {
      expect(c('--text', '--selection')).toBeGreaterThanOrEqual(4.5)
    })
    it.each(['--bg', '--bg-sidebar'])('--active indicator stands out on %s ≥ 3:1', (bg) => {
      expect(c('--active', bg)).toBeGreaterThanOrEqual(3)
    })
    it('text on --active ≥ 4.5:1', () => {
      expect(c('--active-text', '--active')).toBeGreaterThanOrEqual(4.5)
    })
    it('warning text on --bg and on its own background ≥ 4.5:1', () => {
      expect(c('--accent-warn', '--bg')).toBeGreaterThanOrEqual(4.5)
      expect(c('--accent-warn', '--accent-warn-bg')).toBeGreaterThanOrEqual(4.5)
    })
  })
})

function token(body: string, name: string): string {
  const m = body.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})\\s*;`, 'i'))
  if (!m) throw new Error(`${name} is not a 6-digit hex colour`)
  return m[1]
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
