import { describe, expect, it } from 'vitest'
import { httpError, networkError, ProviderError, rejectsTools } from './errors'

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

  it('maps a Google 400 API_KEY_INVALID to the rejected-key copy', () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }]
      }
    })
    expect(httpError('google', 400, body).message).toBe(
      'The Google API key was rejected. Check it in Settings.'
    )
    expect(httpError('google', 400, '{"error":{"message":"bad request"}}').message).toBe(
      'Google returned an error (400): bad request'
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

  it('keeps the status and body on http errors', () => {
    const e = httpError('openai', 500, '{"error":{"message":"boom"}}')
    expect(e.status).toBe(500)
    expect(e.body).toBe('{"error":{"message":"boom"}}')
    expect(httpError('openai', 401, 'nope').status).toBe(401)
  })

  it('rejectsTools spots tool-unsupported errors', () => {
    const ollama = '{"error":"registry.ollama.ai/library/gemma does not support tools"}'
    expect(rejectsTools(httpError('local', 400, ollama))).toBe(true)
    expect(rejectsTools(httpError('local', 404, 'function calling unsupported'))).toBe(true)
    expect(rejectsTools(httpError('local', 422, 'tools not allowed'))).toBe(true)
    expect(rejectsTools(httpError('local', 501, 'Tool use not implemented'))).toBe(true)
    expect(rejectsTools(httpError('local', 400, 'bad request'))).toBe(false)
    expect(rejectsTools(httpError('local', 500, 'tools are broken'))).toBe(false)
    expect(rejectsTools(new ProviderError('tools'))).toBe(false)
    expect(rejectsTools(new Error('400 does not support tools'))).toBe(false)
    expect(rejectsTools(null)).toBe(false)
  })

  it('rethrows aborts unchanged', () => {
    const abort = new DOMException('aborted', 'AbortError')
    expect(() => networkError('openai', abort)).toThrow(abort)
  })
})
