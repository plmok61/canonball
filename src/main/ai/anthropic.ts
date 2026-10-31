import type { ModelInfo } from '../../shared/ai'
import {
  mergeAiMessages,
  parseToolArgs,
  type Adapter,
  type AiMessage,
  type ProviderConfig
} from './adapter'
import { ProviderError, networkError } from './errors'
import { readJson, send } from './http'
import { parseSse } from './sse'

interface WireMessage {
  role: 'user' | 'assistant'
  content: string | Record<string, unknown>[]
}

function blocks(content: WireMessage['content']): Record<string, unknown>[] {
  if (typeof content !== 'string') return content
  return content === '' ? [] : [{ type: 'text', text: content }]
}

/** Maps messages to Anthropic turns; tool results ride in a user turn, merged with any user text after them. */
function toWire(messages: AiMessage[]): WireMessage[] {
  const out: WireMessage[] = []
  const push = (m: WireMessage): void => {
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content = [...blocks(last.content), ...blocks(m.content)]
    else out.push(m)
  }
  for (const m of mergeAiMessages(messages)) {
    if (m.role === 'user') {
      push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        push({
          role: 'assistant',
          content: [
            ...blocks(m.content),
            ...m.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))
          ]
        })
      } else {
        push({ role: 'assistant', content: m.content })
      }
    } else {
      push({
        role: 'user',
        content: m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.callId,
          content: r.content,
          is_error: r.isError
        }))
      })
    }
  }
  return out
}

function headers(cfg: ProviderConfig, json: boolean): Record<string, string> {
  const h: Record<string, string> = { 'anthropic-version': '2023-06-01' }
  if (json) h['Content-Type'] = 'application/json'
  if (cfg.apiKey) h['x-api-key'] = cfg.apiKey
  return h
}

export const anthropic: Adapter = {
  async listModels(cfg, fetchFn) {
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/models?limit=1000`, {
      method: 'GET',
      headers: headers(cfg, false)
    })
    const data = ((await readJson(cfg, res)) as { data?: unknown } | null)?.data
    const models: ModelInfo[] = []
    if (Array.isArray(data)) {
      for (const m of data) {
        const { id, display_name } = (m ?? {}) as { id?: unknown; display_name?: unknown }
        if (typeof id !== 'string' || id === '') continue
        models.push({
          provider: cfg.provider,
          model: id,
          label: typeof display_name === 'string' && display_name !== '' ? display_name : id
        })
      }
    }
    return models.sort((a, b) => a.label.localeCompare(b.label))
  },

  async *streamChat(cfg, args, fetchFn) {
    const body: Record<string, unknown> = {
      model: args.model,
      max_tokens: 8192,
      system: args.system,
      messages: toWire(args.messages),
      stream: true
    }
    if (args.tools && args.tools.length > 0) {
      body.tools = args.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }))
    }
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/messages`, {
      method: 'POST',
      headers: headers(cfg, true),
      body: JSON.stringify(body),
      signal: args.signal
    })
    if (!res.body) return
    const open = new Map<number, { id: string; name: string; json: string }>()
    try {
      for await (const ev of parseSse(res.body)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          continue
        }
        const p = parsed as {
          type?: unknown
          index?: unknown
          content_block?: { type?: unknown; id?: unknown; name?: unknown }
          delta?: { type?: unknown; text?: unknown; partial_json?: unknown }
          error?: { message?: unknown }
        } | null
        const type = p?.type ?? ev.event
        const index = typeof p?.index === 'number' ? p.index : 0
        if (type === 'message_stop') return
        if (type === 'error') {
          const m = p?.error?.message
          throw new ProviderError(
            `Anthropic returned an error: ${typeof m === 'string' && m !== '' ? m : 'unknown error'}`
          )
        }
        if (type === 'content_block_start' && p?.content_block?.type === 'tool_use') {
          const { id, name } = p.content_block
          open.set(index, {
            id: typeof id === 'string' ? id : '',
            name: typeof name === 'string' ? name : '',
            json: ''
          })
        } else if (type === 'content_block_delta' && p?.delta?.type === 'text_delta') {
          const text = p.delta.text
          if (typeof text === 'string' && text !== '') yield { type: 'text', text }
        } else if (type === 'content_block_delta' && p?.delta?.type === 'input_json_delta') {
          const call = open.get(index)
          const part = p.delta.partial_json
          if (call && typeof part === 'string') call.json += part
        } else if (type === 'content_block_stop') {
          const call = open.get(index)
          if (call) {
            open.delete(index)
            const input = parseToolArgs(call.json)
            yield { type: 'tool_call', call: { id: call.id, name: call.name, args: input } }
          }
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
  }
}
