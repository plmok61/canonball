import { describe, expect, it } from 'vitest'
import { anthropic } from './anthropic'
import { ProviderError } from './errors'
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

function ev(obj: { type: string } & Record<string, unknown>): string {
  return `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`
}

const TOOL = {
  name: 'read_file',
  description: 'Read a file.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
}

async function collect(fetchFn: FetchFn, over: Partial<StreamArgs> = {}): Promise<StreamPart[]> {
  const out: StreamPart[] = []
  for await (const p of anthropic.streamChat(cfg, { ...args(), ...over }, fetchFn)) out.push(p)
  return out
}

describe('anthropic tools', () => {
  it('streams text then a tool use', async () => {
    const fetchFn: FetchFn = async () =>
      sseResponse([
        ev({ type: 'message_start' }),
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        ev({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Checking.' }
        }),
        ev({ type: 'content_block_stop', index: 0 }),
        ev({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} }
        }),
        ev({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"pa' }
        }),
        ev({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: 'th":"a.md"}' }
        }),
        ev({ type: 'content_block_stop', index: 1 }),
        ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
        ev({ type: 'message_stop' })
      ])
    expect(await collect(fetchFn, { tools: [TOOL] })).toEqual([
      { type: 'text', text: 'Checking.' },
      { type: 'tool_call', call: { id: 'toolu_1', name: 'read_file', args: { path: 'a.md' } } }
    ])
  })

  it('a tool use without input and one with broken input both get an empty object', async () => {
    const fetchFn: FetchFn = async () =>
      sseResponse([
        ev({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 't1', name: 'list_files', input: {} }
        }),
        ev({ type: 'content_block_stop', index: 0 }),
        ev({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 't2', name: 'read_file', input: {} }
        }),
        ev({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"pa' }
        }),
        ev({ type: 'content_block_stop', index: 1 }),
        ev({ type: 'message_stop' })
      ])
    expect(await collect(fetchFn, { tools: [TOOL] })).toEqual([
      { type: 'tool_call', call: { id: 't1', name: 'list_files', args: {} } },
      { type: 'tool_call', call: { id: 't2', name: 'read_file', args: {} } }
    ])
  })

  it('sends input_schema tools', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchFn: FetchFn = async (_u, init) => {
      bodies.push(JSON.parse(init!.body as string))
      return sseResponse([ev({ type: 'message_stop' })])
    }
    await collect(fetchFn, { tools: [TOOL] })
    await collect(fetchFn, { tools: [] })
    expect(bodies[0].tools).toEqual([
      { name: 'read_file', description: 'Read a file.', input_schema: TOOL.parameters }
    ])
    expect(bodies[1]).not.toHaveProperty('tools')
  })

  it('replays tool_use and tool_result blocks', async () => {
    let body: { messages: unknown[] } = { messages: [] }
    const fetchFn: FetchFn = async (_u, init) => {
      body = JSON.parse(init!.body as string)
      return sseResponse([ev({ type: 'message_stop' })])
    }
    await collect(fetchFn, {
      tools: [TOOL],
      messages: [
        { role: 'user', content: 'Read a and b' },
        {
          role: 'assistant',
          content: 'Reading.',
          toolCalls: [
            { id: 't1', name: 'read_file', args: { path: 'a.md' } },
            { id: 't2', name: 'read_file', args: { path: 'b.md' } }
          ]
        },
        {
          role: 'tool',
          results: [
            { callId: 't1', name: 'read_file', content: 'A text', isError: false },
            { callId: 't2', name: 'read_file', content: 'Not found', isError: true }
          ]
        }
      ]
    })
    expect(body.messages).toEqual([
      { role: 'user', content: 'Read a and b' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading.' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.md' } },
          { type: 'tool_use', id: 't2', name: 'read_file', input: { path: 'b.md' } }
        ]
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'A text', is_error: false },
          { type: 'tool_result', tool_use_id: 't2', content: 'Not found', is_error: true }
        ]
      }
    ])
  })

  it('omits an empty text block when replaying a tool use', async () => {
    let body: { messages: { content: unknown }[] } = { messages: [] }
    const fetchFn: FetchFn = async (_u, init) => {
      body = JSON.parse(init!.body as string)
      return sseResponse([ev({ type: 'message_stop' })])
    }
    await collect(fetchFn, {
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'list_files', args: {} }] },
        {
          role: 'tool',
          results: [{ callId: 't1', name: 'list_files', content: 'a.md', isError: false }]
        }
      ]
    })
    expect(body.messages[1].content).toEqual([
      { type: 'tool_use', id: 't1', name: 'list_files', input: {} }
    ])
  })
})

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
    const out: StreamPart[] = []
    for await (const t of anthropic.streamChat(cfg, args(), fetchFn)) out.push(t)
    expect(out).toEqual([
      { type: 'text', text: 'Hi' },
      { type: 'text', text: ' there' }
    ])
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
