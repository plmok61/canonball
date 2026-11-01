import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname)

// FE0F is deliberately listed
/* eslint-disable no-misleading-character-class */
const SYMBOLS =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2298}\u{FE0F}]/u
/* eslint-enable no-misleading-character-class */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

describe('renderer source', () => {
  it('uses no emoji or symbol characters as icons', () => {
    const hits: string[] = []
    for (const file of sourceFiles(ROOT)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (SYMBOLS.test(line)) hits.push(`${file.slice(ROOT.length + 1)}:${i + 1}`)
        })
    }
    expect(hits, `Use an SVG icon from icons.tsx instead:\n${hits.join('\n')}`).toEqual([])
  })
})
