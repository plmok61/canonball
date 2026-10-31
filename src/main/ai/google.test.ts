import { describe, expect, it } from 'vitest'
import { google } from './google'
import type { FetchFn, ProviderConfig, StreamArgs, StreamPart } from './adapter'

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

function data(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\r\n\r\n`
}

const TOOL = {
  name: 'list_files',
  description: 'List files.',
  parameters: { type: 'object', properties: {} }
}

async function collect(fetchFn: FetchFn, over: Partial<StreamArgs> = {}): Promise<StreamPart[]> {
  const out: StreamPart[] = []
  for await (const p of google.streamChat(
    cfg,
    {
      model: 'gemini-2.5-pro',
      system: 'S',
      messages: [{ role: 'user', content: 'x' }],
      signal: new AbortController().signal,
      ...over
    },
    fetchFn
  ))
    out.push(p)
  return out
}

describe('google tools', () => {
  it('emits function calls and replays them with their signature', async () => {
    const part = { functionCall: { name: 'list_files', args: {} }, thoughtSignature: 'sig' }
    const fetchFn: FetchFn = async () =>
      sseResponse([
        data({ candidates: [{ content: { role: 'model', parts: [{ text: 'Let me look.' }, part] } }] }),
        data({
          candidates: [
            { content: { role: 'model', parts: [{ functionCall: { name: 'read_file', args: 'bad' } }] } }
          ]
        })
      ])
    const out = await collect(fetchFn, { tools: [TOOL] })
    expect(out).toEqual([
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_call', call: { id: 'call_1', name: 'list_files', args: {}, meta: part } },
      {
        type: 'tool_call',
        call: {
          id: 'call_2',
          name: 'read_file',
          args: {},
          meta: { functionCall: { name: 'read_file', args: 'bad' } }
        }
      }
    ])
    const call = (out[1] as Extract<StreamPart, { type: 'tool_call' }>).call

    let body: { contents: unknown[] } = { contents: [] }
    const replayFetch: FetchFn = async (_u, init) => {
      body = JSON.parse(init!.body as string)
      return sseResponse([])
    }
    await collect(replayFetch, {
      tools: [TOOL],
      messages: [
        { role: 'user', content: 'What is there?' },
        { role: 'assistant', content: 'Let me look.', toolCalls: [call] },
        { role: 'tool', results: [{ callId: call.id, name: 'list_files', content: 'a.md (can edit)', isError: false }] },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_9', name: 'read_file', args: { path: 'z' } }] },
        { role: 'tool', results: [{ callId: 'call_9', name: 'read_file', content: 'Nope', isError: true }] }
      ]
    })
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'What is there?' }] },
      { role: 'model', parts: [{ text: 'Let me look.' }, part] },
      {
        role: 'user',
        parts: [{ functionResponse: { name: 'list_files', response: { content: 'a.md (can edit)' } } }]
      },
      { role: 'model', parts: [{ functionCall: { name: 'read_file', args: { path: 'z' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'read_file', response: { error: 'Nope' } } }] }
    ])
  })

  it('sends functionDeclarations', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchFn: FetchFn = async (_u, init) => {
      bodies.push(JSON.parse(init!.body as string))
      return sseResponse([])
    }
    await collect(fetchFn, { tools: [TOOL] })
    await collect(fetchFn, {})
    expect(bodies[0].tools).toEqual([
      { functionDeclarations: [{ name: 'list_files', description: 'List files.', parameters: TOOL.parameters }] }
    ])
    expect(bodies[1]).not.toHaveProperty('tools')
  })
})

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
    const out: StreamPart[] = []
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
    expect(out).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' }
    ])
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
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
    expect(models).toEqual([
      { provider: 'google', model: 'gemini-a', label: 'Gemini A' },
      { provider: 'google', model: 'gemini-b', label: 'Gemini B' }
    ])
  })
})
