import { mergeTurns, type ModelInfo } from '../../shared/ai'
import type { Adapter, ProviderConfig } from './adapter'
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
    const messages = [
      { role: 'system', content: args.system },
      ...mergeTurns(args.messages)
    ]
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headers(cfg, true),
      body: JSON.stringify({ model: args.model, messages, stream: true }),
      signal: args.signal
    })
    if (!res.body) return
    try {
      for await (const ev of parseSse(res.body)) {
        if (ev.data === '[DONE]') return
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          continue
        }
        const content = (parsed as { choices?: { delta?: { content?: unknown } }[] } | null)
          ?.choices?.[0]?.delta?.content
        if (typeof content === 'string' && content !== '') yield content
      }
    } catch (err) {
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
  }
}
