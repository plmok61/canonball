import { describe, expect, it } from 'vitest'
import { httpError, networkError, ProviderError } from './errors'

describe('errors', () => {
  it('maps statuses to writer copy', () => {
    const e = httpError('anthropic', 401, '')
    expect(e).toBeInstanceOf(ProviderError)
    expect(e.name).toBe('ProviderError')
    expect(e.message).toBe('The Anthropic API key was rejected. Check it in Settings.')
    expect(httpError('google', 403, '').message).toBe(
      'The Google API key was rejected. Check it in Settings.'
    )
    expect(httpError('openai', 429, '').message).toBe(
      'OpenAI is busy or rate-limiting requests. Try again in a moment.'
    )
    expect(httpError('openai', 500, '{"error":{"message":"boom"}}').message).toBe(
      'OpenAI returned an error (500): boom'
    )
    const long = 'x'.repeat(300)
    expect(httpError('local', 502, long).message).toBe(
      `Local server returned an error (502): ${'x'.repeat(200)}`
    )
  })

  it('local network failure names the URL', () => {
    expect(
      networkError('local', new TypeError('fetch failed'), 'http://localhost:11434/v1').message
    ).toBe("Couldn't reach the local server at http://localhost:11434/v1. Is it running?")
    expect(networkError('openai', new TypeError('fetch failed')).message).toBe(
      "Couldn't reach OpenAI. Check your internet connection."
    )
  })

  it('rethrows aborts unchanged', () => {
    const abort = new DOMException('aborted', 'AbortError')
    expect(() => networkError('openai', abort)).toThrow(abort)
  })
})
