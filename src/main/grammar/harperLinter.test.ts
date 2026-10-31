import { beforeAll, describe, expect, it } from 'vitest'
import {
  createHarperLinter,
  toGrammarLint,
  type HarperLintLike,
  type TextLinter
} from './harperLinter'

describe('real Harper', () => {
  let linter: TextLinter
  beforeAll(async () => {
    linter = await createHarperLinter()
  }, 30_000)

  it('flags a repeated word with a fix that removes the repeat', async () => {
    const [lints] = await linter.lint(['She went to the the store.'])
    const lint = lints.find((l) => l.problem === 'the the')
    expect(lint).toBeDefined()
    expect(lint!.suggestions.some((s) => s.replacement === 'the')).toBe(true)
  })

  it('spans are UTF-16 offsets', async () => {
    const [lints] = await linter.lint(['🙂🙂 i went home.'])
    expect(lints.some((l) => l.start === 5 && l.end === 6 && l.problem === 'i')).toBe(true)
  })

  it('leaves spelling to Chromium', async () => {
    expect(await linter.lint(['Her eyes are grey.', 'A xylofrabble sat.'])).toEqual([[], []])
  })

  it('returns one result array per text, in order', async () => {
    const out = await linter.lint(['Fine.', 'i went.'])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual([])
    expect(out[1]).toHaveLength(1)
  })
})

function fake(problem: string, suggestions: Array<[number, string]>, start = 0): HarperLintLike {
  return {
    span: () => ({ start, end: start + problem.length }),
    get_problem_text: () => problem,
    message: () => 'msg',
    lint_kind_pretty: () => 'Kind',
    suggestions: () =>
      suggestions.map(([k, t]) => ({ kind: () => k, get_replacement_text: () => t }))
  }
}

describe('toGrammarLint', () => {
  it('normalizes Remove and InsertAfter to whole-span replacements', () => {
    const lint = toGrammarLint(
      fake(',', [
        [2, ' and'],
        [1, '']
      ])
    )
    expect(lint.suggestions).toEqual([
      { label: 'Add " and"', replacement: ', and' },
      { label: 'Remove ","', replacement: '' }
    ])
    expect(lint).toMatchObject({ start: 0, end: 1, problem: ',', message: 'msg', kind: 'Kind' })
  })

  it('labels whitespace fixes in words', () => {
    expect(toGrammarLint(fake('  ', [[0, ' ']])).suggestions).toEqual([
      { label: 'Fix spacing', replacement: ' ' }
    ])
    expect(toGrammarLint(fake('  ', [[1, '']])).suggestions).toEqual([
      { label: 'Remove the extra space', replacement: '' }
    ])
  })

  it('dedupes and caps suggestions at five', () => {
    const many = ['a', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].map((t) => [0, t] as [number, string])
    const out = toGrammarLint(fake('x', many)).suggestions
    expect(out.map((s) => s.replacement)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})
