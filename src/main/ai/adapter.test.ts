import { describe, expect, it } from 'vitest'
import { toAiMessages } from './adapter'

describe('toAiMessages', () => {
  it('merges same-role turns and maps them to text messages', () => {
    expect(
      toAiMessages([
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' }
      ])
    ).toEqual([
      { role: 'user', content: 'a\n\nb' },
      { role: 'assistant', content: 'c' }
    ])
  })
})
