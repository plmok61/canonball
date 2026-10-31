import { mergeTurns, type ModelInfo } from '../../shared/ai'
import type { Adapter, ProviderConfig } from './adapter'
import { ProviderError, networkError } from './errors'
import { readJson, send } from './http'
import { parseSse } from './sse'

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
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/messages`, {
      method: 'POST',
      headers: headers(cfg, true),
      body: JSON.stringify({
        model: args.model,
        max_tokens: 8192,
        system: args.system,
        messages: mergeTurns(args.messages),
        stream: true
      }),
      signal: args.signal
    })
    if (!res.body) return
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
          delta?: { type?: unknown; text?: unknown }
          error?: { message?: unknown }
        } | null
        const type = p?.type ?? ev.event
        if (type === 'message_stop') return
        if (type === 'error') {
          const m = p?.error?.message
          throw new ProviderError(
            `Anthropic returned an error: ${typeof m === 'string' && m !== '' ? m : 'unknown error'}`
          )
        }
        if (type === 'content_block_delta' && p?.delta?.type === 'text_delta') {
          const text = p.delta.text
          if (typeof text === 'string' && text !== '') yield text
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
  }
}
