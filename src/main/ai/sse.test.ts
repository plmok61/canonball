import { describe, expect, it } from 'vitest'
import { parseSse, type SseEvent } from './sse'

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    }
  })
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const e of parseSse(body)) out.push(e)
  return out
}

describe('parseSse', () => {
  it('parses events split across chunks and multibyte characters', async () => {
    const enc = new TextEncoder()
    const emoji = enc.encode('😀')
    const events = await collect(
      streamOf([
        enc.encode('event: a\r\ndata: {"t":"h'),
        emoji.slice(0, 2),
        new Uint8Array([...emoji.slice(2), ...enc.encode('"}\r\n\r\n')])
      ])
    )
    expect(events).toEqual([{ event: 'a', data: '{"t":"h😀"}' }])
  })

  it('joins multi-line data and ignores comments', async () => {
    const enc = new TextEncoder()
    const events = await collect(
      streamOf([
        enc.encode(': hi\ndata: one\ndata: two\n\ndata: three\r\r'),
        enc.encode('data: four\n\n')
      ])
    )
    expect(events).toEqual([
      { event: null, data: 'one\ntwo' },
      { event: null, data: 'three' },
      { event: null, data: 'four' }
    ])
  })
})
