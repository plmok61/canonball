import { describe, expect, it } from 'vitest'
import { anthropic } from './anthropic'
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

const cfg: ProviderConfig = {
  provider: 'anthropic',
  apiKey: 'sk-ant-secret',
  baseUrl: 'https://api.anthropic.com/v1'
}

function args(): Parameters<typeof anthropic.streamChat>[1] {
  return {
    model: 'claude-x',
    system: 'Be brief.',
    messages: [{ role: 'user', content: 'hello' }],
    signal: new AbortController().signal
  }
}

describe('anthropic', () => {
  it('streams text deltas and sends the version header', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fetchFn: FetchFn = async (url, init) => {
      seen = { url: String(url), init: init! }
      return sseResponse([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}\n\n',
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ignored"}}\n\n'
      ])
    }
    const out: string[] = []
    for await (const t of anthropic.streamChat(cfg, args(), fetchFn)) out.push(t)
    expect(out).toEqual(['Hi', ' there'])
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages')
    expect(seen!.url).not.toContain('sk-ant-secret')
    const h = seen!.init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-ant-secret')
    expect(h['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(seen!.init.body as string)
    expect(body).toEqual({
      model: 'claude-x',
      max_tokens: 8192,
      system: 'Be brief.',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    })
  })

  it('an error event becomes a ProviderError', async () => {
    const fetchFn: FetchFn = async () =>
      sseResponse([
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n'
      ])
    const run = async (): Promise<void> => {
      for await (const t of anthropic.streamChat(cfg, args(), fetchFn)) void t
    }
    await expect(run()).rejects.toBeInstanceOf(ProviderError)
    await expect(run()).rejects.toThrow('Anthropic returned an error: Overloaded')
  })

  it('lists models with display names', async () => {
    let url = ''
    let headers: Record<string, string> = {}
    const fetchFn: FetchFn = async (u, init) => {
      url = String(u)
      headers = init!.headers as Record<string, string>
      return new Response(
        JSON.stringify({
          data: [
            { id: 'claude-b', display_name: 'Claude B' },
            { id: 'claude-a', display_name: 'Claude A' }
          ]
        })
      )
    }
    const models = await anthropic.listModels(cfg, fetchFn)
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000')
    expect(headers['x-api-key']).toBe('sk-ant-secret')
    expect(models).toEqual([
      { provider: 'anthropic', model: 'claude-a', label: 'Claude A' },
      { provider: 'anthropic', model: 'claude-b', label: 'Claude B' }
    ])
  })

  it('maps a rejected key to the settings copy', async () => {
    const fetchFn: FetchFn = async () => new Response('{}', { status: 401 })
    await expect(anthropic.listModels(cfg, fetchFn)).rejects.toThrow(
      'The Anthropic API key was rejected. Check it in Settings.'
    )
  })
})
