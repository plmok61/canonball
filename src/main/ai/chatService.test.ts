import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createChatService, MAX_TOOL_ROUNDS } from './chatService'
import { buildInstructions } from './instructions'
import { ProviderError } from './errors'
import { createProposalStore } from './proposals'
import { createProject } from '../projectFs'
import type { FetchFn, ProviderConfig } from './adapter'
import type { ChatEvent, ChatRequest } from '../../shared/ai'

const local: ProviderConfig = { provider: 'local', apiKey: null, baseUrl: 'http://localhost:1/v1' }
const resolveLocal = async (): Promise<ProviderConfig> => local

const req = (requestId = 'r1'): ChatRequest => ({
  requestId,
  model: { provider: 'local', model: 'llama3' },
  messages: [{ role: 'user', content: 'Hi' }]
})

const enc = new TextEncoder()
const delta = (t: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`

function sse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    }
  })
  return new Response(body, { status: 200 })
}

function collect(): { events: ChatEvent[]; ended: Promise<void>; send: (e: ChatEvent) => void } {
  const events: ChatEvent[] = []
  let end!: () => void
  const ended = new Promise<void>((r) => (end = r))
  return {
    events,
    ended,
    send: (e) => {
      events.push(e)
      if (e.kind === 'done' || e.kind === 'error') end()
    }
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

afterEach(() => {
  vi.restoreAllMocks()
})

it('streams deltas then done', async () => {
  let body: { messages: { role: string; content: string }[] } | null = null
  const fetchFn: FetchFn = async (_url, init) => {
    body = JSON.parse(init!.body as string)
    return sse([delta('Hel'), delta('lo'), 'data: [DONE]\n\n'])
  }
  const chat = createChatService({
    resolve: resolveLocal,
    fetch: fetchFn,
    proposals: createProposalStore()
  })
  const c = collect()
  chat.start(req(), null, c.send)
  await c.ended
  await tick()
  expect(c.events).toEqual([
    { requestId: 'r1', kind: 'delta', text: 'Hel' },
    { requestId: 'r1', kind: 'delta', text: 'lo' },
    { requestId: 'r1', kind: 'done', stopped: false }
  ])
  expect(body!.messages[0]).toEqual({
    role: 'system',
    content: buildInstructions({ mode: 'none', memory: [] })
  })
})

it('cancel ends with done stopped:true and aborts the fetch signal', async () => {
  let signal: AbortSignal | undefined
  const fetchFn: FetchFn = async (_url, init) => {
    signal = init!.signal ?? undefined
    const s = signal!
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(delta('Part')))
        s.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')))
      }
    })
    return new Response(stream, { status: 200 })
  }
  const chat = createChatService({
    resolve: resolveLocal,
    fetch: fetchFn,
    proposals: createProposalStore()
  })
  const events: ChatEvent[] = []
  let gotDelta!: () => void
  const firstDelta = new Promise<void>((r) => (gotDelta = r))
  chat.start(req(), null, (e) => {
    events.push(e)
    if (e.kind === 'delta') gotDelta()
  })
  await firstDelta
  chat.cancel('r1')
  await tick()
  expect(signal!.aborted).toBe(true)
  expect(events).toEqual([
    { requestId: 'r1', kind: 'delta', text: 'Part' },
    { requestId: 'r1', kind: 'done', stopped: true }
  ])
})

it('a provider error becomes an error event', async () => {
  const fetchFn: FetchFn = async () => new Response('{"error":{"message":"x"}}', { status: 429 })
  const chat = createChatService({
    resolve: resolveLocal,
    fetch: fetchFn,
    proposals: createProposalStore()
  })
  const c = collect()
  chat.start(req(), null, c.send)
  await c.ended
  await tick()
  expect(c.events).toEqual([
    {
      requestId: 'r1',
      kind: 'error',
      message: 'Local server is busy or rate-limiting requests. Try again in a moment.'
    }
  ])
})

it('a missing key from resolve becomes an error event', async () => {
  const chat = createChatService({
    resolve: async () => {
      throw new ProviderError('Add your OpenAI API key in Settings.')
    },
    fetch: async () => {
      throw new Error('unexpected fetch')
    },
    proposals: createProposalStore()
  })
  const c = collect()
  chat.start(req(), null, c.send)
  await c.ended
  expect(c.events).toEqual([
    { requestId: 'r1', kind: 'error', message: 'Add your OpenAI API key in Settings.' }
  ])
})

it('an unexpected error is reported without details', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  let fetched = false
  // A response whose `ok` getter throws escapes the adapter's error mapping, so
  // a plain TypeError reaches the chat service after the request is in flight.
  const fetchFn: FetchFn = async () => {
    fetched = true
    return {
      get ok(): boolean {
        throw new TypeError('internal detail')
      }
    } as unknown as Response
  }
  const chat = createChatService({
    resolve: async () => ({ ...local, apiKey: 'sk-private-key' }),
    fetch: fetchFn,
    proposals: createProposalStore()
  })
  const c = collect()
  const secretText = 'Chapter nine: the lighthouse keeper lies'
  chat.start(
    {
      requestId: 'req-private-id',
      model: { provider: 'local', model: 'private-model' },
      messages: [{ role: 'user', content: secretText }]
    },
    null,
    c.send
  )
  await c.ended
  expect(fetched).toBe(true)
  expect(c.events).toEqual([
    {
      requestId: 'req-private-id',
      kind: 'error',
      message: 'Something went wrong talking to Local server.'
    }
  ])
  expect(log).toHaveBeenCalled()
  const logged = JSON.stringify(log.mock.calls)
  for (const leak of [
    secretText,
    'lighthouse',
    'sk-private-key',
    'req-private-id',
    'private-model'
  ])
    expect(logged).not.toContain(leak)
})

it('ignores a duplicate active requestId and allows reuse once finished', async () => {
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const fetchFn: FetchFn = async () => {
    calls++
    if (calls === 1) await gate
    return sse([delta('ok'), 'data: [DONE]\n\n'])
  }
  const chat = createChatService({
    resolve: resolveLocal,
    fetch: fetchFn,
    proposals: createProposalStore()
  })
  const a = collect()
  const b = collect()
  chat.start(req(), null, a.send)
  chat.start(req(), null, b.send)
  release()
  await a.ended
  await tick()
  expect(b.events).toEqual([])
  expect(calls).toBe(1)
  const again = collect()
  chat.start(req(), null, again.send)
  await again.ended
  expect(again.events.at(-1)).toEqual({ requestId: 'r1', kind: 'done', stopped: false })
  expect(calls).toBe(2)
})

it('cancelAll stops every active request', async () => {
  const fetchFn: FetchFn = async (_url, init) =>
    new Promise<Response>((_res, rej) => {
      init!.signal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
    })
  const chat = createChatService({
    resolve: resolveLocal,
    fetch: fetchFn,
    proposals: createProposalStore()
  })
  const a = collect()
  const b = collect()
  chat.start(req('a'), null, a.send)
  chat.start(req('b'), null, b.send)
  await tick()
  chat.cancelAll()
  await tick()
  expect(a.events).toEqual([{ requestId: 'a', kind: 'done', stopped: true }])
  expect(b.events).toEqual([{ requestId: 'b', kind: 'done', stopped: true }])
})

describe('with a project', () => {
  const TEMPLATE = path.resolve(__dirname, '../../../template')
  const IDEAS = 'A tidal city.\nA quiet king.\n'
  const CH1 = 'The rain kept on.\n'
  let tmp: string
  let root: string

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-chat-'))
    root = path.join(tmp, 'project')
    await createProject(root, TEMPLATE)
    await fs.writeFile(path.join(root, 'notes/ideas.md'), IDEAS)
    await fs.writeFile(path.join(root, 'drafts/ch1.md'), CH1)
  })
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
  })

  const disk = (rel: string): Promise<string> => fs.readFile(path.join(root, rel), 'utf8')

  const toolCall = (id: string, name: string, args: Record<string, unknown>): string[] => [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          }
        }
      ]
    })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`,
    'data: [DONE]\n\n'
  ]

  interface Body {
    messages: { role: string; content: string | null; tool_call_id?: string }[]
    tools?: unknown[]
  }

  /** Answers request n with script[n] (the last entry repeats); records every body. */
  function scripted(script: (() => Response)[]): { fetch: FetchFn; bodies: Body[] } {
    const bodies: Body[] = []
    return {
      bodies,
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(init!.body as string))
        return script[Math.min(bodies.length - 1, script.length - 1)]()
      }
    }
  }

  const service = (fetchFn: FetchFn): ReturnType<typeof createChatService> =>
    createChatService({ resolve: resolveLocal, fetch: fetchFn, proposals: createProposalStore() })

  const textOf = (events: ChatEvent[]): string =>
    events.map((e) => (e.kind === 'delta' ? e.text : '')).join('')

  it('runs read tools and answers', async () => {
    const f = scripted([
      () => sse(toolCall('c1', 'read_file', { path: 'notes/ideas.md' })),
      () => sse([delta('The city '), delta('is tidal.'), 'data: [DONE]\n\n'])
    ])
    const chat = service(f.fetch)
    const c = collect()
    chat.start(req(), root, c.send)
    await c.ended
    expect(f.bodies).toHaveLength(2)
    expect(f.bodies[0].tools).toHaveLength(4)
    const toolMsg = f.bodies[1].messages.find((m) => m.role === 'tool')
    expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'c1', content: IDEAS })
    expect(c.events).toEqual([
      { requestId: 'r1', kind: 'delta', text: 'The city ' },
      { requestId: 'r1', kind: 'delta', text: 'is tidal.' },
      { requestId: 'r1', kind: 'done', stopped: false }
    ])
  })

  it('emits a proposal event and writes nothing', async () => {
    const f = scripted([
      () =>
        sse(
          toolCall('c1', 'propose_edit', {
            path: 'notes/ideas.md',
            edits: [{ old_text: 'quiet king', new_text: 'loud queen' }]
          })
        ),
      () => sse([delta('Suggested.'), 'data: [DONE]\n\n'])
    ])
    const chat = service(f.fetch)
    const c = collect()
    chat.start(req(), root, c.send)
    await c.ended
    const proposals = c.events.filter((e) => e.kind === 'proposal')
    expect(proposals).toHaveLength(1)
    expect(proposals[0]).toMatchObject({
      requestId: 'r1',
      kind: 'proposal',
      proposal: {
        kind: 'edit',
        relPath: 'notes/ideas.md',
        before: IDEAS,
        after: 'A tidal city.\nA loud queen.\n',
        status: 'pending'
      }
    })
    expect(c.events.at(-1)).toEqual({ requestId: 'r1', kind: 'done', stopped: false })
    expect(await disk('notes/ideas.md')).toBe(IDEAS)
  })

  it('stops after the tool round limit', async () => {
    const f = scripted([() => sse(toolCall('c1', 'list_files', {}))])
    const chat = service(f.fetch)
    const c = collect()
    chat.start(req(), root, c.send)
    await c.ended
    await tick()
    expect(f.bodies).toHaveLength(MAX_TOOL_ROUNDS)
    expect(c.events.slice(-2)).toEqual([
      {
        requestId: 'r1',
        kind: 'delta',
        text: '\n\n(I stopped after 10 file steps. Ask me to continue if you need more.)'
      },
      { requestId: 'r1', kind: 'done', stopped: false }
    ])
  })

  it('falls back when the model rejects tools', async () => {
    const reply =
      'Sure <canonball-edit path="notes/ideas.md"><old>quiet king</old><new>loud queen</new></canonball-edit>'
    const f = scripted([
      () => new Response('{"error":{"message":"llama3 does not support tools"}}', { status: 400 }),
      () => sse([delta(reply.slice(0, 12)), delta(reply.slice(12)), 'data: [DONE]\n\n']),
      () => sse([delta('Again.'), 'data: [DONE]\n\n'])
    ])
    const chat = service(f.fetch)
    const c = collect()
    chat.start(req(), root, c.send)
    await c.ended
    expect(f.bodies).toHaveLength(2)
    expect(f.bodies[0].tools).toBeDefined()
    expect(f.bodies[1].tools).toBeUndefined()
    expect(f.bodies[1].messages[0].content).toContain('<file path="notes/ideas.md"')
    expect(textOf(c.events)).toBe('Sure ')
    expect(c.events.filter((e) => e.kind === 'proposal')).toHaveLength(1)
    expect(c.events.at(-1)).toEqual({ requestId: 'r1', kind: 'done', stopped: false })
    expect(await disk('notes/ideas.md')).toBe(IDEAS)

    const again = collect()
    chat.start(req('r2'), root, again.send)
    await again.ended
    expect(f.bodies).toHaveLength(3)
    expect(f.bodies[2].tools).toBeUndefined()
    expect(f.bodies[2].messages[0].content).toContain('<file path="notes/ideas.md"')
  })

  it('a fallback block for a draft is refused in the reply', async () => {
    const block =
      '<canonball-edit path="drafts/ch1.md"><old>rain</old><new>snow</new></canonball-edit>'
    const f = scripted([
      () => new Response('{"error":{"message":"model does not support tools"}}', { status: 400 }),
      () => sse([delta(block), 'data: [DONE]\n\n'])
    ])
    const chat = service(f.fetch)
    const c = collect()
    chat.start(req(), root, c.send)
    await c.ended
    expect(c.events.filter((e) => e.kind === 'proposal')).toHaveLength(0)
    expect(textOf(c.events)).toContain(
      "Couldn't suggest that change: Prose is never edited by the AI"
    )
    expect(c.events.at(-1)).toEqual({ requestId: 'r1', kind: 'done', stopped: false })
    expect(await disk('drafts/ch1.md')).toBe(CH1)
  })

  it('without a project no tools are offered', async () => {
    const f = scripted([() => sse([delta('Hi.'), 'data: [DONE]\n\n'])])
    const chat = service(f.fetch)
    const c = collect()
    chat.start(req(), null, c.send)
    await c.ended
    expect(f.bodies).toHaveLength(1)
    expect(f.bodies[0].tools).toBeUndefined()
    expect(f.bodies[0].messages[0].content).toBe(buildInstructions({ mode: 'none', memory: [] }))
  })
})
