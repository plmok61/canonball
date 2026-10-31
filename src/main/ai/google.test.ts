import { describe, expect, it } from 'vitest'
import { google } from './google'
import type { FetchFn, ProviderConfig } from './adapter'

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    }
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const cfg: ProviderConfig = {
  provider: 'google',
  apiKey: 'g-secret',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta'
}

describe('google', () => {
  it('streams text and maps assistant to model', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchFn: FetchFn = async (url, init) => {
      seen = { url: String(url), init: init! }
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"Hel"},{"text":"lo"}]}}]}\r\n\r\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" world"}]}}]}\r\n\r\n',
        'data: {"usageMetadata":{}}\r\n\r\n'
      ])
    }
    const out: string[] = []
    for await (const t of google.streamChat(
      cfg,
      {
        model: 'gemini-2.5-pro',
        system: 'Be brief.',
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' }
        ],
        signal: new AbortController().signal
      },
      fetchFn
    ))
      out.push(t)
    expect(out).toEqual(['Hello', ' world'])
    expect(seen!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse'
    )
    expect(seen!.url).not.toContain('g-secret')
    expect((seen!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('g-secret')
    const body = JSON.parse(seen!.init.body as string)
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be brief.' }] })
    expect(body.contents[1].role).toBe('model')
    expect(body.contents[1].parts).toEqual([{ text: 'b' }])
    expect(body.contents[0].role).toBe('user')
  })

  it('lists gemini models that generate content', async () => {
    let url = ''
    const fetchFn: FetchFn = async (u) => {
      url = String(u)
      return new Response(
        JSON.stringify({
          models: [
            { name: 'models/gemini-b', displayName: 'Gemini B', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
            {
              name: 'models/gemini-a',
              displayName: 'Gemini A',
              supportedGenerationMethods: ['generateContent', 'countTokens']
            },
            { name: 'models/gemini-embed', displayName: 'Gemini Embed', supportedGenerationMethods: ['embedContent'] }
          ]
        })
      )
    }
    const models = await google.listModels(cfg, fetchFn)
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(models).toEqual([
      { provider: 'google', model: 'gemini-a', label: 'Gemini A' },
      { provider: 'google', model: 'gemini-b', label: 'Gemini B' }
    ])
  })
})
