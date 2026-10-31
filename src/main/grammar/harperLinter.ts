import type { GrammarLint, GrammarSuggestion } from '../../shared/types'

/** The structural subset of harper.js's Lint that we read. */
export interface HarperLintLike {
  span(): { start: number; end: number }
  get_problem_text(): string
  message(): string
  lint_kind_pretty(): string
  suggestions(): { kind(): number; get_replacement_text(): string }[]
}

export interface TextLinter {
  lint(texts: string[]): Promise<GrammarLint[][]>
}

const MAX_SUGGESTIONS = 5

function normalizeSuggestion(
  kind: number,
  text: string,
  problem: string
): GrammarSuggestion | null {
  const blank = problem.trim() === ''
  switch (kind) {
    case 0:
      return { replacement: text, label: text.trim() === '' ? 'Fix spacing' : text }
    case 1:
      return {
        replacement: '',
        label: blank ? 'Remove the extra space' : `Remove "${problem}"`
      }
    case 2:
      return { replacement: problem + text, label: `Add "${text}"` }
    default:
      return null
  }
}

export function toGrammarLint(lint: HarperLintLike): GrammarLint {
  const { start, end } = lint.span()
  const problem = lint.get_problem_text()
  const seen = new Set<string>()
  const suggestions: GrammarSuggestion[] = []
  for (const s of lint.suggestions()) {
    const n = normalizeSuggestion(s.kind(), s.get_replacement_text(), problem)
    if (!n || seen.has(n.replacement)) continue
    seen.add(n.replacement)
    suggestions.push(n)
    if (suggestions.length >= MAX_SUGGESTIONS) break
  }
  return {
    start,
    end,
    problem,
    message: lint.message(),
    kind: lint.lint_kind_pretty(),
    suggestions
  }
}

export async function createHarperLinter(): Promise<TextLinter> {
  const { LocalLinter, Dialect } = await import('harper.js')
  const { binary } = await import('harper.js/binary')
  const linter = new LocalLinter({ binary, dialect: Dialect.American })
  await linter.setup()
  // Chromium owns spelling; Harper's SpellCheck would also flag "grey" etc.
  const config = await linter.getLintConfig()
  await linter.setLintConfig({ ...config, SpellCheck: false })
  return {
    async lint(texts) {
      const out: GrammarLint[][] = []
      for (const text of texts) {
        const lints = await linter.lint(text, { language: 'plaintext' })
        out.push(lints.map(toGrammarLint))
      }
      return out
    }
  }
}
