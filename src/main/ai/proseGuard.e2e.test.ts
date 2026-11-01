import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createChatService } from './chatService'
import { createProposalStore } from './proposals'
import type { ProposalStore } from './proposals'
import { createProject } from '../projectFs'
import { setProsePaths } from '../projectSettings'
import type { FetchFn, ProviderConfig } from './adapter'
import type { ChatEvent, ChatRequest } from '../../shared/ai'

const TEMPLATE = path.resolve(__dirname, '../../../template')
const CH1 = 'The rain kept on.\nIt did not stop.\n'
const NOTE = 'A tidal city.\n'
const PROSE_ERROR = 'Prose is never edited by the AI'

type Wire = 'openai' | 'anthropic' | 'google'

const CONFIG: Record<Wire, ProviderConfig> = {
  openai: { provider: 'openai', apiKey: 'sk-test', baseUrl: 'https://openai.test/v1' },
  anthropic: { provider: 'anthropic', apiKey: 'sk-ant', baseUrl: 'https://anthropic.test/v1' },
  google: { provider: 'google', apiKey: 'g-key', baseUrl: 'https://google.test/v1beta' }
}

const enc = new TextEncoder()

function sse(lines: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    }
  })
  return new Response(body, { status: 200 })
}

const ev = (obj: { type: string } & Record<string, unknown>): string =>
  `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`

const openaiDelta = (t: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`

/** One scripted model turn that calls a tool, in the given provider's wire format. */
function toolTurn(wire: Wire, id: string, name: string, args: Record<string, unknown>): Response {
  if (wire === 'openai') {
    return sse([
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
    ])
  }
  if (wire === 'anthropic') {
    return sse([
      ev({ type: 'message_start' }),
      ev({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id, name, input: {} }
      }),
      ev({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) }
      }),
      ev({ type: 'content_block_stop', index: 0 }),
      ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }),
      ev({ type: 'message_stop' })
    ])
  }
  return sse([
    `data: ${JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] } }]
    })}\r\n\r\n`
  ])
}

function textTurn(wire: Wire, text: string): Response {
  if (wire === 'openai') return sse([openaiDelta(text), 'data: [DONE]\n\n'])
  if (wire === 'anthropic') {
    return sse([
      ev({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text }
      }),
      ev({ type: 'message_stop' })
    ])
  }
  return sse([
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n`
  ])
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

const textOf = (events: ChatEvent[]): string =>
  events.map((e) => (e.kind === 'delta' ? e.text : '')).join('')

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else out.push(path.relative(base, full))
  }
  return out.sort()
}

describe('the AI never writes prose', () => {
  let tmp: string
  let root: string
  let proposals: ProposalStore
  let before: Map<string, string>

  const snapshot = async (): Promise<Map<string, string>> => {
    const m = new Map<string, string>()
    for (const dir of ['drafts', 'manuscript']) {
      for (const rel of await walk(path.join(root, dir), root)) {
        m.set(rel, await fs.readFile(path.join(root, rel), 'utf8'))
      }
    }
    return m
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'canonball-prose-'))
    root = path.join(tmp, 'project')
    await createProject(root, TEMPLATE)
    await fs.mkdir(path.join(root, 'drafts/chapters'), { recursive: true })
    await fs.writeFile(path.join(root, 'drafts/chapters/ch1.md'), CH1)
    await fs.mkdir(path.join(root, 'manuscript'), { recursive: true })
    await fs.writeFile(path.join(root, 'manuscript/one.md'), 'Once upon a time.\n')
    await fs.writeFile(path.join(root, 'notes/x.md'), NOTE)
    proposals = createProposalStore()
    before = await snapshot()
  })

  afterEach(async () => {
    const after = await snapshot()
    expect([...after.entries()]).toEqual([...before.entries()])
    await fs.rm(tmp, { recursive: true, force: true })
  })

  function request(wire: Wire): ChatRequest {
    const model = { openai: 'gpt-x', anthropic: 'claude-x', google: 'gemini-x' }[wire]
    return {
      requestId: 'r1',
      model: { provider: wire, model },
      messages: [{ role: 'user', content: 'Work on chapter one.' }]
    }
  }

  /** Runs one chat where the model makes the given calls (one per round), then answers. */
  async function runCalls(
    wire: Wire,
    calls: { name: string; args: Record<string, unknown> }[]
  ): Promise<{ events: ChatEvent[]; bodies: string[] }> {
    const bodies: string[] = []
    const fetchFn: FetchFn = async (_url, init) => {
      bodies.push(init!.body as string)
      const n = bodies.length - 1
      if (n < calls.length) return toolTurn(wire, `call_${n}`, calls[n].name, calls[n].args)
      return textTurn(wire, 'Done.')
    }
    const chat = createChatService({
      resolve: async () => CONFIG[wire],
      fetch: fetchFn,
      proposals
    })
    const c = collect()
    chat.start(request(wire), root, c.send)
    await c.ended
    return { events: c.events, bodies }
  }

  const noProposals = (events: ChatEvent[]): void => {
    expect(events.filter((e) => e.kind === 'proposal')).toHaveLength(0)
    expect(events.at(-1)).toEqual({ requestId: 'r1', kind: 'done', stopped: false })
  }

  describe("a tool-calling model can't propose an edit to a draft", () => {
    for (const wire of ['openai', 'anthropic', 'google'] as const) {
      it(wire, async () => {
        const { events, bodies } = await runCalls(wire, [
          {
            name: 'propose_edit',
            args: {
              path: 'drafts/chapters/ch1.md',
              edits: [{ old_text: 'rain', new_text: 'snow' }]
            }
          },
          {
            name: 'create_note',
            args: { path: 'drafts/chapters/ch2.md', content: 'A new chapter.' }
          }
        ])
        noProposals(events)
        // Round 2 replays the error for the first call; round 3 for both.
        expect(bodies).toHaveLength(3)
        expect(bodies[1]).toContain(PROSE_ERROR)
        expect(bodies[2]).toContain(PROSE_ERROR)
        expect(bodies[1]).toContain('Error: ')
        expect(bodies[2]).toContain('drafts/chapters/ch2.md')
        await expect(fs.access(path.join(root, 'drafts/chapters/ch2.md'))).rejects.toThrow()
      })
    }
  })

  it("a fallback model can't propose an edit to a draft", async () => {
    const reply =
      'Sure. <canonball-edit path="drafts/chapters/ch1.md"><old>rain</old><new>snow</new></canonball-edit>' +
      '<canonball-create path="drafts/chapters/ch2.md">A new chapter.</canonball-create>'
    let n = 0
    const fetchFn: FetchFn = async () => {
      n++
      if (n === 1) {
        return new Response('{"error":{"message":"llama3 does not support tools"}}', {
          status: 400
        })
      }
      return sse([openaiDelta(reply), 'data: [DONE]\n\n'])
    }
    const chat = createChatService({
      resolve: async () => ({ provider: 'local', apiKey: null, baseUrl: 'http://localhost:1/v1' }),
      fetch: fetchFn,
      proposals
    })
    const c = collect()
    chat.start(
      {
        requestId: 'r1',
        model: { provider: 'local', model: 'llama3' },
        messages: [{ role: 'user', content: 'Edit it.' }]
      },
      root,
      c.send
    )
    await c.ended
    noProposals(c.events)
    const text = textOf(c.events)
    expect(text).not.toContain('<canonball-')
    expect(
      text.match(/Couldn't suggest that change: Prose is never edited by the AI/g)
    ).toHaveLength(2)
    await expect(fs.access(path.join(root, 'drafts/chapters/ch2.md'))).rejects.toThrow()
  })

  it('a prose folder chosen by the writer is protected too', async () => {
    await setProsePaths(root, ['manuscript'])
    const { events, bodies } = await runCalls('openai', [
      {
        name: 'propose_edit',
        args: { path: 'manuscript/one.md', edits: [{ old_text: 'Once', new_text: 'Twice' }] }
      },
      { name: 'create_note', args: { path: 'manuscript/two.md', content: 'More.' } }
    ])
    noProposals(events)
    expect(bodies[1]).toContain(PROSE_ERROR)
    expect(bodies[2]).toContain(PROSE_ERROR)
    await expect(fs.access(path.join(root, 'manuscript/two.md'))).rejects.toThrow()
  })

  it("case and dot-dot spellings don't get around it", async () => {
    const { events, bodies } = await runCalls('openai', [
      {
        name: 'propose_edit',
        args: {
          path: 'DRAFTS/chapters/ch1.md',
          edits: [{ old_text: 'rain', new_text: 'snow' }]
        }
      },
      {
        name: 'propose_edit',
        args: {
          path: 'notes/../drafts/chapters/ch1.md',
          edits: [{ old_text: 'rain', new_text: 'snow' }]
        }
      },
      {
        name: 'create_note',
        args: { path: 'Drafts/../drafts/chapters/ch3.md', content: 'x' }
      }
    ])
    noProposals(events)
    expect(bodies).toHaveLength(4)
    // Every call came back as an error result.
    const last = JSON.parse(bodies[3]) as { messages: { role: string; content: string }[] }
    const results = last.messages.filter((m) => m.role === 'tool')
    expect(results).toHaveLength(3)
    for (const r of results) expect(r.content).toMatch(/^Error: /)
    await expect(fs.access(path.join(root, 'drafts/chapters/ch3.md'))).rejects.toThrow()
  })

  it('accepting a proposal never lands in drafts', async () => {
    const { events } = await runCalls('openai', [
      {
        name: 'propose_edit',
        args: { path: 'notes/x.md', edits: [{ old_text: 'tidal', new_text: 'dry' }] }
      }
    ])
    const made = events.filter((e) => e.kind === 'proposal')
    expect(made).toHaveLength(1)
    const id = (made[0] as Extract<ChatEvent, { kind: 'proposal' }>).proposal.id

    // The writer then marks notes as a prose folder; Accept must be refused.
    await setProsePaths(root, ['notes'])
    await expect(proposals.apply(root, id)).rejects.toThrow()
    expect(await fs.readFile(path.join(root, 'notes/x.md'), 'utf8')).toBe(NOTE)
    await expect(fs.access(path.join(root, 'drafts/x.md'))).rejects.toThrow()
  })

  it('style rules and names to avoid reach the model', async () => {
    const style = await fs.readFile(path.join(root, 'memory/style_rules.md'), 'utf8')
    const names = await fs.readFile(path.join(root, 'memory/names_to_avoid.md'), 'utf8')
    const bodyOf = (s: string): string => s.replace(/^---\n[\s\S]*?\n---\n/, '').trim()

    const { bodies } = await runCalls('anthropic', [])
    const system = (JSON.parse(bodies[0]) as { system: string }).system
    expect(system).toContain(bodyOf(style))
    expect(system).toContain(bodyOf(names))
  })
})
