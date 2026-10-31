import { expect, it } from 'vitest'
import { countWords } from './wordCount'

it('counts tokens containing a letter or digit', () => {
  expect(countWords('She left. He — stayed.')).toBe(4)
})

it('returns 0 for whitespace', () => {
  expect(countWords('  ')).toBe(0)
})
