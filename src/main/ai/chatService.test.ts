import { afterEach, expect, it, vi } from 'vitest'
import { createChatService } from './chatService'
import { CHAT_INSTRUCTIONS } from './instructions'
import { ProviderError } from './errors'
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
      if (e.kind !== 'delta') end()
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
  const chat = createChatService({ resolve: resolveLocal, fetch: fetchFn })
  const c = collect()
  chat.start(req(), c.send)
  await c.ended
  await tick()
  expect(c.events).toEqual([
    { requestId: 'r1', kind: 'delta', text: 'Hel' },
    { requestId: 'r1', kind: 'delta', text: 'lo' },
    { requestId: 'r1', kind: 'done', stopped: false }
  ])
  expect(body!.messages[0]).toEqual({ role: 'system', content: CHAT_INSTRUCTIONS })
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
  const chat = createChatService({ resolve: resolveLocal, fetch: fetchFn })
  const events: ChatEvent[] = []
  let gotDelta!: () => void
  const firstDelta = new Promise<void>((r) => (gotDelta = r))
  chat.start(req(), (e) => {
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
  const chat = createChatService({ resolve: resolveLocal, fetch: fetchFn })
  const c = collect()
  chat.start(req(), c.send)
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
    }
  })
  const c = collect()
  chat.start(req(), c.send)
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
    fetch: fetchFn
  })
  const c = collect()
  const secretText = 'Chapter nine: the lighthouse keeper lies'
  chat.start(
    {
      requestId: 'req-private-id',
      model: { provider: 'local', model: 'private-model' },
      messages: [{ role: 'user', content: secretText }]
    },
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
  const chat = createChatService({ resolve: resolveLocal, fetch: fetchFn })
  const a = collect()
  const b = collect()
  chat.start(req(), a.send)
  chat.start(req(), b.send)
  release()
  await a.ended
  await tick()
  expect(b.events).toEqual([])
  expect(calls).toBe(1)
  const again = collect()
  chat.start(req(), again.send)
  await again.ended
  expect(again.events.at(-1)).toEqual({ requestId: 'r1', kind: 'done', stopped: false })
  expect(calls).toBe(2)
})

it('cancelAll stops every active request', async () => {
  const fetchFn: FetchFn = async (_url, init) =>
    new Promise<Response>((_res, rej) => {
      init!.signal!.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
    })
  const chat = createChatService({ resolve: resolveLocal, fetch: fetchFn })
  const a = collect()
  const b = collect()
  chat.start(req('a'), a.send)
  chat.start(req('b'), b.send)
  await tick()
  chat.cancelAll()
  await tick()
  expect(a.events).toEqual([{ requestId: 'a', kind: 'done', stopped: true }])
  expect(b.events).toEqual([{ requestId: 'b', kind: 'done', stopped: true }])
})
