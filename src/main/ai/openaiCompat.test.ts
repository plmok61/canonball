import { describe, expect, it } from 'vitest'
import { openaiCompat } from './openaiCompat'
import { ProviderError } from './errors'
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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status })
}

const cfg: ProviderConfig = { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1' }

describe('openaiCompat', () => {
  it('streams text deltas', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchFn: FetchFn = async (url, init) => {
      seen = { url: String(url), init: init! }
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n'
      ])
    }
    const out: string[] = []
    for await (const t of openaiCompat.streamChat(
      cfg,
      {
        model: 'gpt-4o',
        system: 'Be brief.',
        messages: [
          { role: 'user', content: 'a' },
          { role: 'user', content: 'b' }
        ],
        signal: new AbortController().signal
      },
      fetchFn
    ))
      out.push(t)
    expect(out).toEqual(['Hel', 'lo'])
    expect(seen!.url).toBe('https://api.openai.com/v1/chat/completions')
    const body = JSON.parse(seen!.init.body as string)
    expect(body.stream).toBe(true)
    expect(body.model).toBe('gpt-4o')
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be brief.' })
    expect(body.messages).toHaveLength(2)
    expect(body.messages[1]).toEqual({ role: 'user', content: 'a\n\nb' })
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('omits the auth header without a key', async () => {
    let headers: Record<string, string> = {}
    const fetchFn: FetchFn = async (_u, init) => {
      headers = init!.headers as Record<string, string>
      return sseResponse(['data: [DONE]\n\n'])
    }
    const local: ProviderConfig = { provider: 'local', apiKey: null, baseUrl: 'http://localhost:11434/v1' }
    for await (const t of openaiCompat.streamChat(
      local,
      { model: 'm', system: '', messages: [{ role: 'user', content: 'x' }], signal: new AbortController().signal },
      fetchFn
    ))
      void t
    expect(headers.Authorization).toBeUndefined()
  })

  it('lists and filters OpenAI chat models', async () => {
    const fetchFn: FetchFn = async (url, init) => {
      expect(String(url)).toBe('https://api.openai.com/v1/models')
      expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
      return json({
        data: [
          { id: 'gpt-4o' },
          { id: 'o3-mini' },
          { id: 'text-embedding-3-small' },
          { id: 'gpt-4o-realtime' },
          { id: 'dall-e-3' }
        ]
      })
    }
    const models = await openaiCompat.listModels(cfg, fetchFn)
    expect(models.map((m) => m.model)).toEqual(['gpt-4o', 'o3-mini'])
    expect(models[0]).toEqual({ provider: 'openai', model: 'gpt-4o', label: 'gpt-4o' })
  })

  it('lists every local model', async () => {
    const fetchFn: FetchFn = async () => json({ data: [{ id: 'llama3' }, { id: 'text-embedding-x' }] })
    const local: ProviderConfig = { provider: 'local', apiKey: null, baseUrl: 'http://localhost:11434/v1' }
    const models = await openaiCompat.listModels(local, fetchFn)
    expect(models.map((m) => m.model)).toEqual(['llama3', 'text-embedding-x'])
    expect(models.every((m) => m.provider === 'local')).toBe(true)
  })

  it('throws ProviderError on a 401', async () => {
    const fetchFn: FetchFn = async () => json({ error: { message: 'bad key' } }, 401)
    await expect(openaiCompat.listModels(cfg, fetchFn)).rejects.toBeInstanceOf(ProviderError)
    await expect(
      (async () => {
        for await (const t of openaiCompat.streamChat(
          cfg,
          { model: 'm', system: '', messages: [{ role: 'user', content: 'x' }], signal: new AbortController().signal },
          fetchFn
        ))
          void t
      })()
    ).rejects.toThrow('The OpenAI API key was rejected. Check it in Settings.')
  })

  it('maps fetch failures to a network error', async () => {
    const fetchFn: FetchFn = async () => {
      throw new TypeError('fetch failed')
    }
    await expect(openaiCompat.listModels(cfg, fetchFn)).rejects.toThrow(
      "Couldn't reach OpenAI. Check your internet connection."
    )
  })
})
