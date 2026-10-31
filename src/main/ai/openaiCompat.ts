import type { ModelInfo } from '../../shared/ai'
import {
  isPlainObject,
  mergeAiMessages,
  parseToolArgs,
  type Adapter,
  type AiMessage,
  type ProviderConfig,
  type StreamPart
} from './adapter'
import { networkError } from './errors'
import { send } from './http'
import { parseSse } from './sse'

export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

const OPENAI_EXCLUDED = ['audio', 'realtime', 'transcribe', 'tts', 'image', 'embedding', 'search']

function isOpenAiChatModel(id: string): boolean {
  const wanted = id.startsWith('gpt-') || id.startsWith('chatgpt-') || /^o\d/.test(id)
  return wanted && !OPENAI_EXCLUDED.some((w) => id.includes(w))
}

function headers(cfg: ProviderConfig, json: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`
  return h
}

export const openaiCompat: Adapter = {
  async listModels(cfg, fetchFn) {
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/models`, {
      method: 'GET',
      headers: headers(cfg, false)
    })
    let json: unknown
    try {
      json = await res.json()
    } catch (err) {
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
    const data = (json as { data?: unknown } | null)?.data
    const ids: string[] = Array.isArray(data)
      ? data
          .map((m) => (m as { id?: unknown } | null)?.id)
          .filter((id): id is string => typeof id === 'string' && id !== '')
      : []
    const models: ModelInfo[] = ids
      .filter((id) => cfg.provider !== 'openai' || isOpenAiChatModel(id))
      .map((id) => ({ provider: cfg.provider, model: id, label: id }))
    return models.sort((a, b) => a.label.localeCompare(b.label))
  },

  async *streamChat(cfg, args, fetchFn) {
    const messages = [{ role: 'system', content: args.system }, ...toWire(args.messages)]
    const body: Record<string, unknown> = { model: args.model, messages, stream: true }
    if (args.tools && args.tools.length > 0) {
      body.tools = args.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }))
    }
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(cfg, true),
      body: JSON.stringify(body),
      signal: args.signal
    })
    if (!res.body) return
    const pending = new Map<number, { id: string; name: string; args: string }>()
    function* flush(): Generator<StreamPart> {
      const calls = [...pending.entries()].sort((a, b) => a[0] - b[0])
      pending.clear()
      for (const [index, c] of calls) {
        // Some local servers omit the id; the replay still needs one to pair results with calls.
        const id = c.id || `call_${index}`
        yield { type: 'tool_call', call: { id, name: c.name, args: parseToolArgs(c.args) } }
      }
    }
    try {
      for await (const ev of parseSse(res.body)) {
        if (ev.data === '[DONE]') break
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          continue
        }
        const choice = (parsed as { choices?: unknown[] } | null)?.choices?.[0] as
          | { delta?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }
          | undefined
        const content = choice?.delta?.content
        if (typeof content === 'string' && content !== '') yield { type: 'text', text: content }
        const deltas = choice?.delta?.tool_calls
        if (Array.isArray(deltas)) {
          for (const d of deltas) accumulate(pending, d)
        }
        if (typeof choice?.finish_reason === 'string') yield* flush()
      }
    } catch (err) {
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
    yield* flush()
  }
}

function accumulate(
  pending: Map<number, { id: string; name: string; args: string }>,
  delta: unknown
): void {
  if (!isPlainObject(delta)) return
  const index = typeof delta.index === 'number' ? delta.index : 0
  const entry = pending.get(index) ?? { id: '', name: '', args: '' }
  if (typeof delta.id === 'string' && delta.id !== '') entry.id = delta.id
  const fn = isPlainObject(delta.function) ? delta.function : {}
  if (typeof fn.name === 'string') entry.name += fn.name
  if (typeof fn.arguments === 'string') entry.args += fn.arguments
  pending.set(index, entry)
}

function toWire(messages: AiMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of mergeAiMessages(messages)) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
    } else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: JSON.stringify(c.args) }
          }))
        })
      } else {
        out.push({ role: 'assistant', content: m.content })
      }
    } else {
      for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.callId, content: r.content })
    }
  }
  return out
}
