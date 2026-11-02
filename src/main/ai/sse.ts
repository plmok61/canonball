export interface SseEvent {
  event: string | null
  data: string
}

/** Parses a server-sent-events body (the subset providers use). */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const decoder = new TextDecoder()
  const reader = body.getReader()
  let buffer = ''
  let event: string | null = null
  let data: string[] = []

  function* handleLine(line: string): Generator<SseEvent> {
    if (line === '') {
      if (data.length > 0) yield { event, data: data.join('\n') }
      event = null
      data = []
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  function* drain(final: boolean): Generator<SseEvent> {
    let start = 0
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i]
      if (ch !== '\n' && ch !== '\r') continue
      if (ch === '\r' && i === buffer.length - 1 && !final) break // might be half of \r\n
      yield* handleLine(buffer.slice(start, i))
      if (ch === '\r' && buffer[i + 1] === '\n') i++
      start = i + 1
    }
    buffer = buffer.slice(start)
  }

  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      yield* drain(false)
    }
    buffer += decoder.decode()
    yield* drain(true)
    if (buffer !== '') yield* handleLine(buffer)
  } finally {
    reader.cancel().catch(() => {})
  }
}
